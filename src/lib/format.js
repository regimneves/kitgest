// Padrão Softia: R$ 1.410,00 e vírgula decimal.
export function formatarMoeda(v) {
  const n = Number(v ?? 0)
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Data "AAAA-MM-DD" → "DD/MM/AAAA" (sem fuso: trata como data pura).
export function formatarData(iso) {
  if (!iso) return ''
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return d ? `${d}/${m}/${a}` : iso
}

// Competência "AAAA-MM-01" → "MM/AAAA".
export function formatarCompetencia(iso) {
  if (!iso) return ''
  const [a, m] = String(iso).slice(0, 10).split('-')
  return m ? `${m}/${a}` : iso
}

// Valor por extenso em reais (p/ o recibo). Suporta até bilhões.
export function valorPorExtenso(valor) {
  const n = Math.round(Number(valor || 0) * 100)
  const reais = Math.floor(n / 100)
  const centavos = n % 100
  const u = ['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez',
    'onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove']
  const dez = ['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa']
  const cem = ['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos']

  function ate999(x) {
    if (x === 0) return ''
    if (x === 100) return 'cem'
    const c = Math.floor(x / 100)
    const resto = x % 100
    let s = c ? cem[c] : ''
    if (resto) {
      if (s) s += ' e '
      if (resto < 20) s += u[resto]
      else {
        s += dez[Math.floor(resto / 10)]
        if (resto % 10) s += ' e ' + u[resto % 10]
      }
    }
    return s
  }

  function porExtenso(x) {
    if (x === 0) return 'zero'
    const grupos = []
    let resto = x, i = 0
    const nomes = [
      ['', ''],
      ['mil', 'mil'],
      ['milhão', 'milhões'],
      ['bilhão', 'bilhões']
    ]
    while (resto > 0) {
      grupos.push(resto % 1000)
      resto = Math.floor(resto / 1000)
    }
    const partes = []      // { texto, valor } de cada grupo não-vazio, do maior p/ o menor
    for (i = grupos.length - 1; i >= 0; i--) {
      const g = grupos[i]
      if (!g) continue
      const txt = i === 1 && g === 1 ? '' : ate999(g)   // "mil" (não "um mil")
      const nome = nomes[i] ? (g === 1 ? nomes[i][0] : nomes[i][1]) : ''
      partes.push({ texto: (txt ? txt + ' ' : '') + nome, valor: g })
    }
    // Junta com ", " mas usa " e " antes do último grupo quando ele é < 100 ou múltiplo de 100.
    let out = ''
    partes.forEach((p, idx) => {
      if (idx === 0) { out = p.texto; return }
      const ehUltimo = idx === partes.length - 1
      const usaE = ehUltimo && (p.valor < 100 || p.valor % 100 === 0)
      out += (usaE ? ' e ' : ', ') + p.texto
    })
    return out.trim()
  }

  const parteReais = `${porExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`
  if (centavos === 0) return parteReais
  const parteCent = `${porExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`
  return `${parteReais} e ${parteCent}`
}

// Converte o que o usuário digita ("1.410,50" ou "1410.5") em número.
export function parseMoeda(s) {
  if (s === null || s === undefined || s === '') return 0
  if (typeof s === 'number') return s
  const limpo = String(s).replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? n : 0
}
