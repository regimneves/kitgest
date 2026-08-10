// Helpers da leva de GESTÃO: configuração (avisos + alertas) e datas de vencimento.

// Config padrão — usada quando a org ainda não personalizou em Configuração.
export const CONFIG_PADRAO = {
  avisos: {
    ativo: true,
    dias: [7, 2, 0]        // marcos antes do vencimento; 0 = no dia do vencimento
  },
  alertas: {
    contrato_vencendo_dias: 30,   // avisa contratos com data_fim próxima
    vaga_dias: 15,                // quarto vago há mais de X dias
    manutencao_parada_dias: 7     // ordem aberta há mais de X dias
  }
}

// Lê a config da org, mesclando com os padrões (tolerante a campos ausentes).
export function lerConfig(org) {
  const c = org?.gestao_config || {}
  return {
    avisos: { ...CONFIG_PADRAO.avisos, ...(c.avisos || {}) },
    alertas: { ...CONFIG_PADRAO.alertas, ...(c.alertas || {}) }
  }
}

// "AAAA-MM" (input month) → primeiro dia como "AAAA-MM-01" (competência do banco).
export function competenciaISO(mesAAAAMM) {
  return `${mesAAAAMM}-01`
}

// Data de vencimento de um contrato numa competência: usa o dia_vencimento,
// grampeado ao último dia do mês (ex.: dia 31 em fevereiro vira 28/29).
export function vencimentoNaCompetencia(dia, mesAAAAMM) {
  if (!dia) return null
  const [ano, mes] = mesAAAAMM.split('-').map(Number)
  const ultimoDia = new Date(ano, mes, 0).getDate()
  return new Date(ano, mes - 1, Math.min(dia, ultimoDia))
}

// Meia-noite de hoje (comparações de dias sem hora).
export function hoje0() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// Diferença em dias inteiros entre uma data e hoje (>0 futuro, 0 hoje, <0 passado).
export function diasAte(data) {
  if (!data) return null
  return Math.round((data - hoje0()) / 86400000)
}

// Mês atual como "AAAA-MM".
export const mesAtual = () => new Date().toISOString().slice(0, 7)

// Template padrão do aviso de vencimento.
// Placeholders: {nome} {quarto} {valor} {vencimento} {quando} {competencia} {pix}
export const TEMPLATE_PADRAO =
  'Olá {nome}! Passando pra lembrar do aluguel do {quarto} ({competencia}), no valor de {valor}, que vence {quando} ({vencimento}).{pix}\n\nQualquer dúvida, estou à disposição!'

// Rótulos amigáveis dos tipos de conta a pagar.
export const TIPO_CONTA = {
  aluguel_mae: 'Aluguel da casa (mãe)',
  energia: 'Energia',
  agua: 'Água',
  gas: 'Gás',
  internet: 'Internet',
  iptu: 'IPTU',
  limpeza: 'Limpeza',
  seguro: 'Seguro',
  funcionario: 'Funcionário',
  outro: 'Outro'
}
