// Geração do recibo de aluguel em PDF (jsPDF desenhado à mão — não html2canvas,
// que sai torto no celular) + QR do PIX. jspdf/qrcode entram por import dinâmico
// para não pesar o bundle inicial nem o precache do PWA.
import { formatarMoeda, formatarData, formatarCompetencia, valorPorExtenso } from './format'

const FORMA_TXT = {
  dinheiro: 'dinheiro', pix: 'PIX', transferencia: 'transferência',
  cartao: 'cartão', outro: 'outro'
}

// Data URL de um QR (PNG) para exibir na tela ou embutir no PDF.
export async function gerarQRDataURL(texto, tamanho = 240) {
  const QR = (await import('qrcode')).default
  return QR.toDataURL(texto, { margin: 1, width: tamanho, errorCorrectionLevel: 'M' })
}

/**
 * Monta e baixa o recibo em PDF.
 * @param {object} p
 * @param {object} p.org           orgs (nome, pix_*, cidade…)
 * @param {object} p.recebimento   { valor, competencia, forma, recibo_numero, pago_em, observacoes }
 * @param {object} p.inquilino     { nome, cpf }
 * @param {object} p.quarto        { identificacao }
 * @param {object} p.casa          { nome }
 * @param {string} [p.pixBRCode]   copia-e-cola do PIX (embute QR se presente)
 */
export async function gerarReciboPDF({ org, recebimento, inquilino, quarto, casa, pixBRCode }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const M = 18            // margem
  let y = 22

  const cor = org?.cor_primaria || '#1e293b'
  const numero = recebimento.recibo_numero != null
    ? String(recebimento.recibo_numero).padStart(4, '0') : '—'

  // Cabeçalho
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(cor)
  doc.text(org?.nome || 'KitGest', M, y)
  doc.setFontSize(11); doc.setTextColor('#334155')
  doc.text(`RECIBO Nº ${numero}`, W - M, y, { align: 'right' })

  y += 7
  doc.setDrawColor(cor); doc.setLineWidth(0.6); doc.line(M, y, W - M, y)

  y += 11
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor('#0f172a')
  doc.text('RECIBO DE ALUGUEL', M, y)

  // Caixa do valor
  y += 8
  doc.setFillColor('#f1f5f9'); doc.setDrawColor('#cbd5e1'); doc.setLineWidth(0.3)
  doc.roundedRect(M, y, W - 2 * M, 13, 2, 2, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(cor)
  doc.text(`VALOR: ${formatarMoeda(recebimento.valor)}`, M + 4, y + 8.5)

  // Corpo
  y += 22
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor('#1e293b')
  const local = casa?.nome ? `${casa.nome} — ` : ''
  const cpf = inquilino?.cpf ? ` (CPF ${inquilino.cpf})` : ''
  const corpo =
    `Recebemos de ${inquilino?.nome || 'inquilino'}${cpf} a importância de ` +
    `${formatarMoeda(recebimento.valor)} (${valorPorExtenso(recebimento.valor)}), ` +
    `referente ao aluguel do quarto ${quarto?.identificacao || '—'} — ${local}` +
    `competência ${formatarCompetencia(recebimento.competencia)}` +
    `${recebimento.forma ? `, pago em ${FORMA_TXT[recebimento.forma] || recebimento.forma}` : ''}. ` +
    `Para clareza, firmamos o presente recibo, dando plena quitação do valor referente a esta competência.`
  const linhas = doc.splitTextToSize(corpo, W - 2 * M)
  doc.text(linhas, M, y, { lineHeightFactor: 1.5 })
  y += linhas.length * 6 + 8

  if (recebimento.observacoes) {
    const obs = doc.splitTextToSize(`Obs.: ${recebimento.observacoes}`, W - 2 * M)
    doc.setTextColor('#475569'); doc.setFontSize(10)
    doc.text(obs, M, y, { lineHeightFactor: 1.4 })
    y += obs.length * 5 + 6
    doc.setTextColor('#1e293b'); doc.setFontSize(11)
  }

  // Data + assinatura
  const cidade = org?.pix_cidade || org?.cidade || ''
  const dataPag = recebimento.pago_em ? new Date(recebimento.pago_em) : new Date()
  const dataStr = formatarData(dataPag.toISOString())
  y += 4
  doc.text(`${cidade ? cidade + ', ' : ''}${dataStr}.`, M, y)

  y += 20
  doc.setDrawColor('#334155'); doc.setLineWidth(0.3)
  doc.line(M, y, M + 80, y)
  doc.setFontSize(10); doc.setTextColor('#334155')
  doc.text(org?.pix_nome_recebedor || org?.nome || 'Recebedor', M, y + 5)

  // Bloco PIX (opcional)
  if (pixBRCode) {
    try {
      const qr = await gerarQRDataURL(pixBRCode, 240)
      const qy = y + 14
      doc.setDrawColor('#cbd5e1'); doc.setLineWidth(0.3)
      doc.line(M, qy, W - M, qy)
      doc.addImage(qr, 'PNG', M, qy + 4, 32, 32)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(cor)
      doc.text('Pague com PIX', M + 38, qy + 10)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor('#475569')
      const cc = doc.splitTextToSize(pixBRCode, W - 2 * M - 40)
      doc.text(cc.slice(0, 6), M + 38, qy + 16, { lineHeightFactor: 1.3 })
    } catch { /* sem QR se der erro; o recibo continua válido */ }
  }

  const fnome = `Recibo-${numero}-${(inquilino?.nome || 'inquilino').split(' ')[0]}.pdf`
  doc.save(fnome)
  return fnome
}

const TIPO_ACERTO = {
  dano: 'Dano', pendencia: 'Pendência', limpeza: 'Limpeza', chave: 'Chave', outro: 'Outro'
}

/**
 * Recibo de acerto de saída (devolução de caução − descontos).
 * @param {object} p
 * @param {object} p.org
 * @param {object} p.acerto      { caucao_valor, total_descontos, valor_a_devolver, recibo_numero, realizado_em, observacoes }
 * @param {object} p.inquilino   { nome, cpf }
 * @param {object} p.quarto      { identificacao }
 * @param {object} p.casa        { nome }
 * @param {Array}  p.itens       [{ tipo, descricao, valor }]
 * @returns {Promise<string>} nome do arquivo (baixa direto)
 */
export async function gerarAcertoPDF({ org, acerto, inquilino, quarto, casa, itens }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, M = 18
  let y = 22
  const cor = org?.cor_primaria || '#1e293b'
  const numero = acerto.recibo_numero != null ? String(acerto.recibo_numero).padStart(4, '0') : '—'
  const devolver = Number(acerto.valor_a_devolver || 0)
  const aCobrar = devolver < 0

  // Cabeçalho
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(cor)
  doc.text(org?.nome || 'KitGest', M, y)
  doc.setFontSize(11); doc.setTextColor('#334155')
  doc.text(`ACERTO Nº ${numero}`, W - M, y, { align: 'right' })
  y += 7
  doc.setDrawColor(cor); doc.setLineWidth(0.6); doc.line(M, y, W - M, y)
  y += 11
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor('#0f172a')
  doc.text('ACERTO DE SAÍDA / DEVOLUÇÃO DE CAUÇÃO', M, y)

  // Dados
  y += 10
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor('#1e293b')
  const cpf = inquilino?.cpf ? ` (CPF ${inquilino.cpf})` : ''
  const local = `${casa?.nome ? casa.nome + ' · ' : ''}${quarto?.identificacao || '—'}`
  doc.text(`Inquilino: ${inquilino?.nome || '—'}${cpf}`, M, y); y += 6
  doc.text(`Quarto: ${local}`, M, y); y += 10

  // Caução
  doc.setFont('helvetica', 'bold')
  doc.text('Caução recebida:', M, y)
  doc.text(formatarMoeda(acerto.caucao_valor), W - M, y, { align: 'right' }); y += 8

  // Descontos
  doc.setFont('helvetica', 'bold'); doc.text('Descontos:', M, y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  if (!itens || itens.length === 0) {
    doc.setTextColor('#64748b'); doc.text('— sem descontos —', M + 2, y); y += 6; doc.setTextColor('#1e293b')
  } else {
    for (const it of itens) {
      const label = `${TIPO_ACERTO[it.tipo] || it.tipo}${it.descricao ? ' — ' + it.descricao : ''}`
      const linhas = doc.splitTextToSize(label, W - 2 * M - 30)
      doc.text(linhas, M + 2, y)
      doc.text('- ' + formatarMoeda(it.valor), W - M, y, { align: 'right' })
      y += linhas.length * 5 + 1
    }
  }
  doc.setFontSize(11)
  y += 2; doc.setDrawColor('#cbd5e1'); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 6
  doc.setFont('helvetica', 'bold')
  doc.text('Total de descontos:', M, y)
  doc.text('- ' + formatarMoeda(acerto.total_descontos), W - M, y, { align: 'right' }); y += 10

  // Resultado (caixa)
  doc.setFillColor(aCobrar ? '#fef2f2' : '#f0fdf4')
  doc.setDrawColor(aCobrar ? '#fca5a5' : '#86efac'); doc.setLineWidth(0.4)
  doc.roundedRect(M, y, W - 2 * M, 15, 2, 2, 'FD')
  doc.setFontSize(13); doc.setTextColor(aCobrar ? '#b91c1c' : '#15803d')
  const rotulo = aCobrar ? 'VALOR A COBRAR DO INQUILINO' : 'VALOR A DEVOLVER'
  doc.text(rotulo, M + 4, y + 9.5)
  doc.text(formatarMoeda(Math.abs(devolver)), W - M - 4, y + 9.5, { align: 'right' })
  y += 22

  // Frase de quitação
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor('#1e293b')
  const frase = aCobrar
    ? `Fica o inquilino ciente do saldo devedor de ${formatarMoeda(Math.abs(devolver))} (${valorPorExtenso(Math.abs(devolver))}) após o abatimento da caução.`
    : `Declaramos a devolução de ${formatarMoeda(devolver)} (${valorPorExtenso(devolver)}), referente ao saldo da caução após os descontos acima, dando as partes plena quitação do contrato.`
  const fl = doc.splitTextToSize(frase, W - 2 * M)
  doc.text(fl, M, y, { lineHeightFactor: 1.5 }); y += fl.length * 6 + 6

  if (acerto.observacoes) {
    doc.setTextColor('#475569'); doc.setFontSize(10)
    const ob = doc.splitTextToSize(`Obs.: ${acerto.observacoes}`, W - 2 * M)
    doc.text(ob, M, y, { lineHeightFactor: 1.4 }); y += ob.length * 5 + 6
    doc.setTextColor('#1e293b'); doc.setFontSize(11)
  }

  // Data + assinaturas
  const cidade = org?.pix_cidade || ''
  const data = acerto.realizado_em ? new Date(acerto.realizado_em) : new Date()
  y += 2
  doc.text(`${cidade ? cidade + ', ' : ''}${formatarData(data.toISOString())}.`, M, y)
  y += 24
  doc.setDrawColor('#334155'); doc.setLineWidth(0.3)
  doc.line(M, y, M + 78, y)
  doc.line(W - M - 78, y, W - M, y)
  doc.setFontSize(9); doc.setTextColor('#334155')
  doc.text(org?.pix_nome_recebedor || org?.nome || 'Recebedor', M, y + 5)
  doc.text(inquilino?.nome || 'Inquilino', W - M - 78, y + 5)

  const fnome = `Acerto-${numero}-${(inquilino?.nome || 'inquilino').split(' ')[0]}.pdf`
  doc.save(fnome)
  return fnome
}
