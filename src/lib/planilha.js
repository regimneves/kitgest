// KitGest — importação de casas/quartos por planilha.
// Funções PURAS (sem DB, sem DOM) para serem testáveis e reaproveitáveis.
// A leitura do arquivo (.xlsx/.csv) fica na página, via SheetJS (import dinâmico).

import { parseMoeda } from './format'

// Normaliza uma chave/valor de texto p/ comparação (sem acento, minúsculo, espaço único).
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ')
}

// Cabeçalhos aceitos → campo canônico. Tolerante a acento/variação.
const SINONIMOS = {
  casa: 'casa', imovel: 'casa', predio: 'casa', 'nome da casa': 'casa',
  endereco: 'endereco', 'endereco da casa': 'endereco',
  'aluguel mae': 'aluguel_mae', 'aluguel-mae': 'aluguel_mae', 'aluguel do proprietario': 'aluguel_mae',
  quarto: 'quarto', 'identificacao': 'quarto', unidade: 'quarto', comodo: 'quarto', 'numero do quarto': 'quarto',
  aluguel: 'aluguel', valor: 'aluguel', 'valor do aluguel': 'aluguel', 'aluguel do quarto': 'aluguel', 'valor final': 'aluguel',
  'area': 'area_m2', 'area m2': 'area_m2', m2: 'area_m2', metragem: 'area_m2',
  capacidade: 'capacidade', moradores: 'capacidade', 'nº moradores': 'capacidade',
  status: 'status', situacao: 'status',
  obs: 'obs', observacao: 'obs', observacoes: 'obs', 'observacoes': 'obs'
}

const STATUS_VALIDOS = new Set(['vago', 'ocupado', 'reservado', 'manutencao'])

// Colunas do modelo, na ordem em que saem no arquivo de exemplo.
export const MODELO = [
  { chave: 'casa', titulo: 'casa', exemplo: 'Casa Amarela' },
  { chave: 'endereco', titulo: 'endereco', exemplo: 'Rua das Flores, 123' },
  { chave: 'aluguel_mae', titulo: 'aluguel_mae', exemplo: '2500,00' },
  { chave: 'quarto', titulo: 'quarto', exemplo: 'Quarto 1' },
  { chave: 'aluguel', titulo: 'aluguel', exemplo: '750,00' },
  { chave: 'area_m2', titulo: 'area_m2', exemplo: '12' },
  { chave: 'capacidade', titulo: 'capacidade', exemplo: '1' },
  { chave: 'status', titulo: 'status', exemplo: 'vago' },
  { chave: 'obs', titulo: 'obs', exemplo: '' }
]

// Linhas de exemplo do modelo (2 casas, 3 quartos) — array de objetos com as chaves do MODELO.
export function linhasModelo() {
  return [
    { casa: 'Casa Amarela', endereco: 'Rua das Flores, 123', aluguel_mae: '2500,00', quarto: 'Quarto 1', aluguel: '750,00', area_m2: '12', capacidade: '1', status: 'ocupado', obs: '' },
    { casa: 'Casa Amarela', endereco: 'Rua das Flores, 123', aluguel_mae: '2500,00', quarto: 'Quarto 2', aluguel: '700,00', area_m2: '10', capacidade: '1', status: 'vago', obs: 'reformar' },
    { casa: 'Casa Azul', endereco: 'Av. Central, 45', aluguel_mae: '1800,00', quarto: 'Suíte', aluguel: '900,00', area_m2: '16', capacidade: '2', status: 'vago', obs: '' }
  ]
}

// Converte um objeto-linha da planilha (chaves = cabeçalhos originais) p/ chaves canônicas.
export function mapearLinha(bruto) {
  const out = {}
  for (const [k, v] of Object.entries(bruto)) {
    const campo = SINONIMOS[norm(k)]
    if (campo && (out[campo] === undefined || out[campo] === '')) out[campo] = v
  }
  return out
}

function coerceStatus(v) {
  const s = norm(v)              // "manutenção" já perde o acento em norm()
  return STATUS_VALIDOS.has(s) ? s : 'vago'
}

// Recebe as linhas cruas (objetos), as casas existentes e os quartos existentes.
// - casasExistentes: [{ id, nome }]
// - quartosExistentes: [{ casa_nome, identificacao }]  (casa_nome = nome da casa do quarto)
// Devolve o PLANO: casas a criar, itens (1 p/ quarto) com ação, e um resumo.
export function planejarImportacao(linhasBrutas, casasExistentes = [], quartosExistentes = []) {
  const casaPorNome = new Map()          // norm(nome) -> { id, nome }
  for (const c of casasExistentes) casaPorNome.set(norm(c.nome), { id: c.id, nome: c.nome })

  const quartoSet = new Set()            // `${normCasa}||${normIdent}`
  for (const q of quartosExistentes) quartoSet.add(`${norm(q.casa_nome)}||${norm(q.identificacao)}`)

  const casasNovas = new Map()           // norm(nome) -> { nome, endereco, aluguel_mae }
  const vistosNoArquivo = new Set()      // dedup dentro do próprio arquivo
  const itens = []

  linhasBrutas.forEach((bruto, i) => {
    const linhaNum = i + 2               // +1 cabeçalho, +1 base-1
    const m = mapearLinha(bruto)
    const casaNome = String(m.casa ?? '').trim()
    const quarto = String(m.quarto ?? '').trim()

    // Linha vazia (sem casa e sem quarto) é ignorada silenciosamente.
    if (!casaNome && !quarto) return

    const item = {
      linha: linhaNum,
      casaNome,
      quarto,
      aluguel: parseMoeda(m.aluguel),
      area_m2: m.area_m2 === undefined || m.area_m2 === '' ? null : parseMoeda(m.area_m2),
      capacidade: m.capacidade === undefined || m.capacidade === '' ? 1 : Math.max(1, Math.round(parseMoeda(m.capacidade))),
      status: coerceStatus(m.status),
      obs: String(m.obs ?? '').trim() || null,
      acao: 'criar',
      motivo: ''
    }

    if (!casaNome) { item.acao = 'erro'; item.motivo = 'sem nome da casa'; itens.push(item); return }
    if (!quarto) { item.acao = 'erro'; item.motivo = 'sem identificação do quarto'; itens.push(item); return }

    const nc = norm(casaNome)
    // Registra casa nova (se não existe no banco). Atributos vêm da 1ª ocorrência.
    if (!casaPorNome.has(nc) && !casasNovas.has(nc)) {
      casasNovas.set(nc, {
        nome: casaNome,
        endereco: String(m.endereco ?? '').trim() || null,
        aluguel_mae: m.aluguel_mae === undefined || m.aluguel_mae === '' ? 0 : parseMoeda(m.aluguel_mae)
      })
    }

    const chaveQuarto = `${nc}||${norm(quarto)}`
    if (quartoSet.has(chaveQuarto) || vistosNoArquivo.has(chaveQuarto)) {
      item.acao = 'duplicado'
      item.motivo = quartoSet.has(chaveQuarto) ? 'já existe no sistema' : 'repetido na planilha'
    } else {
      vistosNoArquivo.add(chaveQuarto)
    }
    itens.push(item)
  })

  const resumo = {
    total: itens.length,
    casasNovas: casasNovas.size,
    quartosNovos: itens.filter(x => x.acao === 'criar').length,
    duplicados: itens.filter(x => x.acao === 'duplicado').length,
    erros: itens.filter(x => x.acao === 'erro').length
  }

  return { casasNovas, itens, resumo, casaPorNome }
}
