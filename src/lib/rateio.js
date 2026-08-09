// Composição do aluguel por rateio das despesas da casa.
// valor_final(quarto) = aluguel_base + fatia das despesas, pelo critério da casa.
// Critérios: 'igual' (por quarto), 'area_m2' (proporcional à área), 'moradores' (à capacidade).

function arred(n) { return Math.round((Number(n) || 0) * 100) / 100 }

// Despesas relevantes para a competência "AAAA-MM": recorrentes (todo mês) +
// as pontuais cuja competência bate com o mês.
export function despesasDaCompetencia(despesas, mes) {
  const m = String(mes || '').slice(0, 7)
  return (despesas || []).filter(d =>
    d.recorrente || (d.competencia && String(d.competencia).slice(0, 7) === m))
}

// Peso de rateio de um quarto conforme o critério.
function pesoQuarto(q, criterio) {
  if (criterio === 'area_m2') return Number(q.area_m2) || 0
  if (criterio === 'moradores') return Number(q.capacidade) || 0
  return 1 // igual
}

/**
 * Calcula a composição de cada quarto.
 * @returns {{
 *   totalDespesas: number,
 *   criterioEfetivo: string,
 *   porQuarto: Array<{ quarto_id, base, total_rateio, valor_final, detalhe: Array<{tipo, valor_rateado}> }>
 * }}
 */
export function calcularRateio(quartos, despesas, criterio) {
  const totalDespesas = arred((despesas || []).reduce((s, d) => s + (Number(d.valor) || 0), 0))

  let criterioEfetivo = criterio || 'igual'
  let pesos = (quartos || []).map(q => pesoQuarto(q, criterioEfetivo))
  let soma = pesos.reduce((a, b) => a + b, 0)
  // Sem base para o critério (ex.: nenhuma área cadastrada) → cai para "igual".
  if (soma === 0) {
    criterioEfetivo = 'igual'
    pesos = (quartos || []).map(() => 1)
    soma = pesos.length
  }

  const porQuarto = (quartos || []).map((q, i) => {
    const fracao = soma > 0 ? pesos[i] / soma : 0
    const detalhe = (despesas || []).map(d => ({
      tipo: d.tipo,
      valor_rateado: arred((Number(d.valor) || 0) * fracao)
    })).filter(x => x.valor_rateado > 0)
    const total_rateio = arred(detalhe.reduce((s, x) => s + x.valor_rateado, 0))
    const base = Number(q.aluguel_base) || 0
    return { quarto_id: q.id, base: arred(base), total_rateio, valor_final: arred(base + total_rateio), detalhe }
  })

  // Ajuste de arredondamento: joga a sobra (total − Σ rateios) no último quarto.
  if (porQuarto.length) {
    const somaRateios = arred(porQuarto.reduce((s, p) => s + p.total_rateio, 0))
    const sobra = arred(totalDespesas - somaRateios)
    if (sobra !== 0) {
      const ult = porQuarto[porQuarto.length - 1]
      ult.total_rateio = arred(ult.total_rateio + sobra)
      ult.valor_final = arred(ult.base + ult.total_rateio)
      if (ult.detalhe.length) ult.detalhe[ult.detalhe.length - 1].valor_rateado =
        arred(ult.detalhe[ult.detalhe.length - 1].valor_rateado + sobra)
    }
  }

  return { totalDespesas, criterioEfetivo, porQuarto }
}
