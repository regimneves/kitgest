// Laudo de vistoria em PDF (jsPDF desenhado à mão). Embute fotos e assinatura.
// jspdf entra por import dinâmico (fora do bundle inicial).
import { formatarData } from './format'

const COND = {
  ok:         { txt: 'OK',        cor: '#22c55e' },
  avaria:     { txt: 'AVARIA',    cor: '#ef4444' },
  observacao: { txt: 'OBSERVAÇÃO', cor: '#eab308' }
}
const TIPO = { entrada: 'ENTRADA', saida: 'SAÍDA' }

/**
 * @param {object} p
 * @param {object} p.org
 * @param {object} p.vistoria   { tipo, responsavel, realizada_em, observacoes }
 * @param {object} p.quarto     { identificacao }
 * @param {object} p.casa       { nome }
 * @param {Array}  p.itens      [{ ambiente, item, condicao, descricao, fotosDataUrls:[] }]
 * @param {string} [p.assinaturaDataURL]
 * @returns {Promise<Blob>} PDF (também pode baixar via caller)
 */
export async function gerarLaudoPDF({ org, vistoria, quarto, casa, itens, assinaturaDataURL }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, H = 297, M = 16
  const cor = org?.cor_primaria || '#1e293b'
  let y = 20

  function quebra(precisa = 8) {
    if (y + precisa > H - M) { doc.addPage(); y = 20 }
  }

  // Cabeçalho
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(cor)
  doc.text(org?.nome || 'KitGest', M, y)
  doc.setFontSize(11); doc.setTextColor('#334155')
  doc.text(`LAUDO DE VISTORIA · ${TIPO[vistoria.tipo] || ''}`, W - M, y, { align: 'right' })
  y += 6
  doc.setDrawColor(cor); doc.setLineWidth(0.6); doc.line(M, y, W - M, y)
  y += 8

  // Dados
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor('#1e293b')
  const local = `${casa?.nome ? casa.nome + ' · ' : ''}${quarto?.identificacao || '—'}`
  doc.text(`Quarto: ${local}`, M, y); y += 6
  if (vistoria.responsavel) { doc.text(`Responsável: ${vistoria.responsavel}`, M, y); y += 6 }
  const data = vistoria.realizada_em ? formatarData(new Date(vistoria.realizada_em).toISOString()) : formatarData(new Date().toISOString())
  doc.text(`Data: ${data}`, M, y); y += 8

  // Itens
  doc.setDrawColor('#e2e8f0')
  for (const it of itens) {
    quebra(16)
    const c = COND[it.condicao] || COND.ok
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor('#0f172a')
    const titulo = `${it.ambiente ? it.ambiente + ' — ' : ''}${it.item}`
    doc.text(doc.splitTextToSize(titulo, W - 2 * M - 34), M, y)
    // etiqueta de condição
    doc.setFontSize(9); doc.setTextColor(c.cor)
    doc.text(`[${c.txt}]`, W - M, y, { align: 'right' })
    y += 6
    if (it.descricao) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor('#475569')
      const linhas = doc.splitTextToSize(it.descricao, W - 2 * M)
      quebra(linhas.length * 5)
      doc.text(linhas, M, y, { lineHeightFactor: 1.4 })
      y += linhas.length * 5 + 1
    }
    // fotos (até 3 por linha)
    const fotos = it.fotosDataUrls || []
    if (fotos.length) {
      const fw = 44, fh = 33, gap = 4
      let x = M
      quebra(fh + 2)
      for (let i = 0; i < fotos.length; i++) {
        if (x + fw > W - M) { x = M; y += fh + gap; quebra(fh + 2) }
        try { doc.addImage(fotos[i], 'JPEG', x, y, fw, fh) } catch { /* ignora foto inválida */ }
        x += fw + gap
      }
      y += fh + 4
    }
    doc.setDrawColor('#e2e8f0'); doc.setLineWidth(0.2)
    quebra(4); doc.line(M, y, W - M, y); y += 6
  }

  // Observações gerais
  if (vistoria.observacoes) {
    quebra(14)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor('#0f172a')
    doc.text('Observações', M, y); y += 6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor('#475569')
    const linhas = doc.splitTextToSize(vistoria.observacoes, W - 2 * M)
    quebra(linhas.length * 5)
    doc.text(linhas, M, y, { lineHeightFactor: 1.4 }); y += linhas.length * 5 + 6
  }

  // Assinatura
  quebra(40)
  y += 6
  if (assinaturaDataURL) {
    try { doc.addImage(assinaturaDataURL, 'PNG', M, y, 60, 24) } catch { /* ignora */ }
    y += 24
  } else {
    y += 24
  }
  doc.setDrawColor('#334155'); doc.setLineWidth(0.3)
  doc.line(M, y, M + 70, y)
  doc.setFontSize(10); doc.setTextColor('#334155')
  doc.text(vistoria.responsavel || org?.pix_nome_recebedor || org?.nome || 'Responsável', M, y + 5)

  return doc.output('blob')
}
