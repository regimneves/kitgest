import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, parseMoeda, formatarCompetencia, formatarData, compararNatural } from '../lib/format'
import { montarPixBRCode } from '../lib/pix'
import { gerarQRDataURL, gerarReciboPDF } from '../lib/recibo'
import { vencimentoNaCompetencia, diasAte, mesAtual, competenciaISO } from '../lib/gestao'
import Modal from '../components/Modal'

const STATUS = {
  pendente: { label: 'Pendente', cor: '#eab308' },
  parcial:  { label: 'Parcial',  cor: '#f97316' },
  pago:     { label: 'Pago',     cor: '#22c55e' },
  atrasado: { label: 'Atrasado', cor: '#ef4444' }
}
const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', transferencia: 'Transferência', cartao: 'Cartão', outro: 'Outro' }
const VIGENTE = ['ativo', 'inadimplente', 'pendente']

// Cores/rótulos dos estágios de cobrança (itens em aberto).
const TAG = {
  atrasado: { t: 'Atrasado', cor: '#ef4444' },
  hoje:     { t: 'Vence hoje', cor: '#f97316' },
  em_breve: { t: 'Vence em breve', cor: '#eab308' },
  a_vencer: { t: 'A vencer', cor: '#3b82f6' },
  sem_data: { t: 'Sem vencimento', cor: '#94a3b8' }
}

// "AAAA-MM" (input month) → "AAAA-MM-01" (date da competência) e volta.
const paraMes = (data) => (data ? String(data).slice(0, 7) : mesAtual())
// data "AAAA-MM-DD" (opcional) → timestamp ISO ao meio-dia (evita virar o dia por fuso).
const dataParaTimestamp = (d) => (d ? new Date(`${d}T12:00:00`).toISOString() : new Date().toISOString())
// hoje como "AAAA-MM-DD" (p/ preencher o input date)
const hojeInput = () => new Date().toISOString().slice(0, 10)

const vazio = () => ({
  contrato_id: '', competencia: mesAtual(), valor: '',
  forma: 'pix', status: 'pago', pago_data: hojeInput(), observacoes: ''
})

// Chave local p/ lembrar o que já foi cobrado no WhatsApp (device-local, 1 operador).
const LOG_KEY = 'kitgest_cobranca_log'
function lerLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '{}') } catch { return {} } }
function gravarLog(l) { try { localStorage.setItem(LOG_KEY, JSON.stringify(l)) } catch { /* ignore */ } }

export default function Recebimentos() {
  const { org } = useOrg()
  const [competencia, setCompetencia] = useState(mesAtual())
  const [contratos, setContratos] = useState([])       // vigentes
  const [recebimentos, setRecebimentos] = useState([]) // da competência selecionada
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(null)
  const [erro, setErro] = useState('')
  const [pix, setPix] = useState(null)                 // { rec, brcode, qr } modal
  const [filtro, setFiltro] = useState('aberto')       // aberto | pago | todos
  const [sel, setSel] = useState(() => new Set())      // contratos selecionados p/ ação em massa
  const [dataReceb, setDataReceb] = useState('')       // data opcional do recebimento (massa/individual)
  const [salvandoMassa, setSalvandoMassa] = useState(false)
  const [log, setLog] = useState(lerLog())

  const pixConfigurado = !!org?.pix_chave

  const carregar = useCallback(async () => {
    setCarregando(true)
    setSel(new Set())
    const compISO = competenciaISO(competencia)
    const [{ data: cs, error }, { data: rs }] = await Promise.all([
      supabase.from('contratos')
        .select('id, inquilino_id, quarto_id, dia_vencimento, valor_aluguel, multa_percentual, juros_dia_percentual, desconto_pontualidade, status, inquilinos(nome, telefone, cpf), quartos(identificacao, casas(nome))')
        .in('status', VIGENTE),
      supabase.from('recebimentos')
        .select('*, inquilinos(nome, telefone, cpf), quartos(identificacao, casas(nome))')
        .eq('competencia', compISO)
        .order('criado_em', { ascending: false })
    ])
    if (error) setErro(error.message)
    setContratos(cs || [])
    setRecebimentos(rs || [])
    setCarregando(false)
  }, [competencia])

  useEffect(() => { carregar() }, [carregar])

  // Um recebimento por contrato nesta competência (prioriza o pago).
  const recPorContrato = useMemo(() => {
    const m = new Map()
    for (const r of recebimentos) {
      if (!r.contrato_id) continue
      const atual = m.get(r.contrato_id)
      if (!atual || (r.status === 'pago' && atual.status !== 'pago')) m.set(r.contrato_id, r)
    }
    return m
  }, [recebimentos])

  // Monta uma linha por contrato vigente + recebimentos avulsos (de contrato já encerrado).
  const linhas = useMemo(() => {
    const usados = new Set()
    const out = []

    for (const c of contratos) {
      const rec = recPorContrato.get(c.id) || null
      if (rec) usados.add(rec.id)
      const pago = rec?.status === 'pago'
      const q = c.quartos
      const local = q ? `${q.casas?.nome ? q.casas.nome + ' · ' : ''}${q.identificacao}` : '—'
      const casaNome = q?.casas?.nome || ''
      const ident = q?.identificacao || ''
      const nome = c.inquilinos?.nome || rec?.inquilinos?.nome || 'Inquilino'
      const valor = pago ? Number(rec.valor || 0) : Number(c.valor_aluguel || 0)

      // Estágio/encargos só p/ item em aberto.
      let estagio = 'sem_data', vencimento = null, dias = null, multa = 0, juros = 0, diasAtraso = 0
      if (!pago) {
        vencimento = vencimentoNaCompetencia(c.dia_vencimento, competencia)
        dias = vencimento ? diasAte(vencimento) : null
        if (dias != null) {
          if (dias < 0) { estagio = 'atrasado'; diasAtraso = -dias }
          else if (dias === 0) estagio = 'hoje'
          else if (dias <= 5) estagio = 'em_breve'
          else estagio = 'a_vencer'
        }
        if (estagio === 'atrasado') {
          multa = valor * (Number(c.multa_percentual || 0) / 100)
          juros = valor * (Number(c.juros_dia_percentual || 0) / 100) * diasAtraso
        }
      }
      const total = valor + multa + juros
      out.push({
        key: c.id, contrato: c, rec, pago, nome, local, casaNome, ident,
        valor, estagio, vencimento, dias, diasAtraso, multa, juros, total,
        tel: c.inquilinos?.telefone || rec?.inquilinos?.telefone
      })
    }

    // Recebimentos que não batem com contrato vigente (ex.: contrato encerrado) — mostra como pago/avulso.
    for (const r of recebimentos) {
      if (usados.has(r.id)) continue
      const q = r.quartos
      const local = q ? `${q.casas?.nome ? q.casas.nome + ' · ' : ''}${q.identificacao}` : '—'
      out.push({
        key: `r-${r.id}`, contrato: null, rec: r, pago: r.status === 'pago',
        nome: r.inquilinos?.nome || 'Inquilino', local, casaNome: q?.casas?.nome || '', ident: q?.identificacao || '',
        valor: Number(r.valor || 0), estagio: r.status === 'pago' ? 'pago' : 'sem_data',
        vencimento: null, dias: null, diasAtraso: 0, multa: 0, juros: 0, total: Number(r.valor || 0),
        tel: r.inquilinos?.telefone
      })
    }
    return out
  }, [contratos, recebimentos, recPorContrato, competencia])

  const abertos = useMemo(() =>
    linhas.filter(l => !l.pago).sort((a, b) => {
      const d = (a.dias ?? 9999) - (b.dias ?? 9999)
      if (d !== 0) return d
      const c = compararNatural(a.casaNome, b.casaNome)
      return c !== 0 ? c : compararNatural(a.ident, b.ident)
    }), [linhas])

  const pagos = useMemo(() =>
    linhas.filter(l => l.pago).sort((a, b) => {
      const c = compararNatural(a.casaNome, b.casaNome)
      return c !== 0 ? c : compararNatural(a.ident, b.ident)
    }), [linhas])

  const visiveis = filtro === 'aberto' ? abertos : filtro === 'pago' ? pagos : [...abertos, ...pagos]

  const resumo = useMemo(() => {
    let recebido = 0
    for (const l of pagos) recebido += l.valor
    const emAbertoV = abertos.reduce((s, l) => s + l.valor, 0)
    const atrasados = abertos.filter(l => l.estagio === 'atrasado')
    const atrasadoV = atrasados.reduce((s, l) => s + l.total, 0)
    return { recebido, emAberto: abertos.length, emAbertoV, atrasados: atrasados.length, atrasadoV }
  }, [abertos, pagos])

  // ---- Seleção múltipla (só itens em aberto que têm contrato) ----
  const selecionaveis = useMemo(() => abertos.filter(l => l.contrato), [abertos])
  const todosSelecionados = selecionaveis.length > 0 && selecionaveis.every(l => sel.has(l.key))
  function alternarSel(key) {
    setSel(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  function alternarTodos() {
    setSel(todosSelecionados ? new Set() : new Set(selecionaveis.map(l => l.key)))
  }
  const selTotal = useMemo(() =>
    selecionaveis.filter(l => sel.has(l.key)).reduce((s, l) => s + l.valor, 0), [selecionaveis, sel])

  // Reserva um nº de recibo atômico (RPC).
  async function proximoRecibo() {
    const { data, error } = await supabase.rpc('proximo_recibo', { p_org: org.id })
    if (error) throw error
    return data
  }

  // Marca 1..N contratos como recebido (pago) na competência selecionada.
  async function receberContratos(linhasAlvo, dataOpcional) {
    setErro(''); setSalvandoMassa(true)
    const quando = dataParaTimestamp(dataOpcional || dataReceb)
    try {
      for (const l of linhasAlvo) {
        if (!l.contrato) continue
        if (l.rec) {
          // já existe registro nesta competência → marca pago
          const patch = { status: 'pago', pago_em: quando, valor: l.rec.valor ?? l.valor }
          if (l.rec.recibo_numero == null) patch.recibo_numero = await proximoRecibo()
          const { error } = await supabase.from('recebimentos').update(patch).eq('id', l.rec.id)
          if (error) throw error
        } else {
          // cria o recebimento pago
          const recibo = await proximoRecibo()
          const payload = {
            org_id: org.id,
            contrato_id: l.contrato.id,
            inquilino_id: l.contrato.inquilino_id,
            quarto_id: l.contrato.quarto_id,
            competencia: competenciaISO(competencia),
            valor: l.valor,
            forma: null,
            status: 'pago',
            pago_em: quando,
            recibo_numero: recibo
          }
          const { error } = await supabase.from('recebimentos').insert(payload)
          if (error) throw error
        }
      }
      setSel(new Set())
      await carregar()
    } catch (err) {
      setErro(err.message)
    } finally {
      setSalvandoMassa(false)
    }
  }

  function receberSelecionados() {
    const alvo = selecionaveis.filter(l => sel.has(l.key))
    if (alvo.length === 0) return
    receberContratos(alvo)
  }

  // ---- Registro manual (modal) ----
  function abrirNovo() {
    setErro('')
    const ini = vazio()
    ini.competencia = competencia
    if (contratos.length === 1) { ini.contrato_id = contratos[0].id; ini.valor = contratos[0].valor_aluguel }
    setEditando(ini)
  }
  function abrirEdicao(rec) {
    setErro('')
    setEditando({
      ...rec,
      competencia: paraMes(rec.competencia),
      valor: rec.valor ?? '',
      forma: rec.forma || 'pix',
      status: rec.status || 'pago',
      pago_data: rec.pago_em ? String(rec.pago_em).slice(0, 10) : hojeInput(),
      observacoes: rec.observacoes || ''
    })
  }
  function escolherContrato(contrato_id) {
    const c = contratos.find(x => x.id === contrato_id)
    setEditando(ed => ({
      ...ed, contrato_id,
      valor: (!ed.id && (ed.valor === '' || ed.valor == null) && c) ? c.valor_aluguel : ed.valor
    }))
  }

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    if (!editando.contrato_id && !editando.id) { setErro('Escolha o contrato.'); return }
    const contrato = contratos.find(c => c.id === editando.contrato_id)
      || { inquilino_id: editando.inquilino_id, quarto_id: editando.quarto_id }

    const payload = {
      org_id: org.id,
      contrato_id: editando.contrato_id,
      inquilino_id: contrato.inquilino_id,
      quarto_id: contrato.quarto_id,
      competencia: competenciaISO(editando.competencia),
      valor: parseMoeda(editando.valor),
      forma: editando.forma || null,
      status: editando.status,
      observacoes: editando.observacoes?.trim() || null
    }
    try {
      const jaPago = editando.status === 'pago'
      const tinhaRecibo = editando.recibo_numero != null
      if (jaPago) {
        payload.pago_em = dataParaTimestamp(editando.pago_data)
        payload.recibo_numero = tinhaRecibo ? editando.recibo_numero : await proximoRecibo()
      }
      const q = editando.id
        ? supabase.from('recebimentos').update(payload).eq('id', editando.id)
        : supabase.from('recebimentos').insert(payload)
      const { error } = await q
      if (error) throw error
      setEditando(null)
      carregar()
    } catch (err) { setErro(err.message) }
  }

  async function excluir(rec) {
    if (!window.confirm(`Excluir o recebimento de ${formatarCompetencia(rec.competencia)}?`)) return
    const { error } = await supabase.from('recebimentos').delete().eq('id', rec.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  // ---- PIX / recibo / WhatsApp ----
  function brCodeDe(valor, txid) {
    return montarPixBRCode({
      chave: org.pix_chave, nome: org.pix_nome_recebedor || org.nome,
      cidade: org.pix_cidade, valor: Number(valor),
      txid: txid || 'KITGEST'
    })
  }
  async function abrirPix(l) {
    setErro('')
    try {
      const valor = l.pago ? l.valor : l.total
      const txid = l.rec?.recibo_numero != null ? `REC${String(l.rec.recibo_numero).padStart(4, '0')}` : 'ALUG' + competencia.replace('-', '')
      const brcode = brCodeDe(valor, txid)
      const qr = await gerarQRDataURL(brcode, 240)
      setPix({ nome: l.nome, valor, brcode, qr, tel: l.tel })
    } catch (err) { setErro(err.message) }
  }
  async function baixarRecibo(rec) {
    setErro('')
    try {
      const brcode = pixConfigurado ? brCodeDe(rec.valor, rec.recibo_numero != null ? `REC${String(rec.recibo_numero).padStart(4, '0')}` : 'KITGEST') : null
      await gerarReciboPDF({
        org, recebimento: rec, inquilino: rec.inquilinos || {},
        quarto: rec.quartos || {}, casa: rec.quartos?.casas || null, pixBRCode: brcode
      })
    } catch (err) { setErro(err.message) }
  }

  // Mensagem de cobrança por estágio (WhatsApp).
  function mensagemCobranca(l) {
    const nome = (l.nome || '').split(' ')[0]
    const comp = formatarCompetencia(competenciaISO(competencia))
    const L = []
    if (l.estagio === 'atrasado') {
      L.push(`Olá ${nome}! Passando sobre o aluguel do ${l.local} (${comp}), que venceu em ${formatarData(l.vencimento.toISOString())} e consta em aberto.`)
      if (l.multa > 0 || l.juros > 0) {
        L.push(`Valor ${formatarMoeda(l.valor)}` +
          (l.multa > 0 ? ` + multa ${formatarMoeda(l.multa)}` : '') +
          (l.juros > 0 ? ` + juros ${formatarMoeda(l.juros)} (${l.diasAtraso} dia(s))` : '') +
          ` = total ${formatarMoeda(l.total)}.`)
      } else L.push(`Valor ${formatarMoeda(l.valor)}.`)
      L.push('Se já efetuou o pagamento, por favor me envie o comprovante e desconsidere. Obrigado!')
    } else if (l.estagio === 'hoje') {
      L.push(`Olá ${nome}! Lembrete: o aluguel do ${l.local} (${comp}), no valor de ${formatarMoeda(l.valor)}, vence hoje.`)
    } else {
      const quando = l.dias === 1 ? 'amanhã' : (l.dias != null ? `em ${l.dias} dias` : 'em breve')
      L.push(`Olá ${nome}! Passando pra lembrar do aluguel do ${l.local} (${comp}), ${formatarMoeda(l.valor)}, que vence ${quando}${l.vencimento ? ` (dia ${l.vencimento.getDate()})` : ''}.`)
      const desc = Number(l.contrato?.desconto_pontualidade || 0)
      if (desc > 0) L.push(`Pagando até o vencimento, você tem ${formatarMoeda(desc)} de desconto.`)
    }
    if (pixConfigurado) L.push('', 'PIX copia e cola:', brCodeDe(l.total, 'ALUG' + competencia.replace('-', '')))
    L.push('', 'Qualquer dúvida, estou à disposição!')
    return L.join('\n')
  }
  function cobrar(l) {
    const d = String(l.tel || '').replace(/\D/g, '')
    if (d.length < 10) { window.alert('Inquilino sem telefone cadastrado. Adicione em Inquilinos.'); return }
    const ddi = d.startsWith('55') ? d : `55${d}`
    window.open(`https://wa.me/${ddi}?text=${encodeURIComponent(mensagemCobranca(l))}`, '_blank')
    const novo = { ...log, [`${l.key}|${competencia}`]: new Date().toISOString() }
    setLog(novo); gravarLog(novo)
  }
  function whatsappSimples(nomeCompleto, tel, valor) {
    const d = String(tel || '').replace(/\D/g, '')
    if (d.length < 10) { window.alert('Inquilino sem telefone cadastrado.'); return }
    const ddi = d.startsWith('55') ? d : `55${d}`
    const nome = (nomeCompleto || '').split(' ')[0]
    const linhas = [`Olá ${nome}! Sobre o aluguel de ${formatarCompetencia(competenciaISO(competencia))} (${formatarMoeda(valor)}).`]
    if (pixConfigurado) linhas.push('', 'PIX copia e cola:', brCodeDe(valor, 'ALUG' + competencia.replace('-', '')))
    window.open(`https://wa.me/${ddi}?text=${encodeURIComponent(linhas.join('\n'))}`, '_blank')
  }
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); window.alert('PIX copiado!') }
    catch { window.prompt('Copie o código PIX:', texto) }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1>Receber &amp; Cobrança</h1>
          <p className="sub" style={{ margin: 0 }}>Marque quem pagou, cobre quem está em aberto — tudo por competência.</p>
        </div>
        <div>
          <label style={{ fontSize: '.8rem' }}>Competência</label>
          <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} />
        </div>
        <button className="ouro" onClick={abrirNovo} disabled={contratos.length === 0} style={{ alignSelf: 'flex-end' }}>+ Registrar</button>
      </div>

      {!pixConfigurado && (
        <div className="card mt" style={{ borderColor: 'var(--cor-ouro)' }}>
          <strong>Dica</strong>
          <p className="sub" style={{ marginBottom: 0 }}>Cadastre sua chave PIX em Configuração para incluir o “copia e cola” automático nas cobranças e recibos.</p>
        </div>
      )}

      {/* Resumo */}
      <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="sub" style={{ fontSize: '.78rem' }}>Recebido</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#22c55e' }}>{formatarMoeda(resumo.recebido)}</div>
          <div className="sub" style={{ fontSize: '.72rem' }}>{pagos.length} pago(s)</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="sub" style={{ fontSize: '.78rem' }}>Em aberto</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{resumo.emAberto}</div>
          <div className="sub" style={{ fontSize: '.72rem' }}>{formatarMoeda(resumo.emAbertoV)}</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="sub" style={{ fontSize: '.78rem' }}>Atrasados</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: resumo.atrasados ? '#ef4444' : 'inherit' }}>{resumo.atrasados}</div>
          <div className="sub" style={{ fontSize: '.72rem' }}>{formatarMoeda(resumo.atrasadoV)} c/ encargos</div>
        </div>
      </div>

      {/* Filtro */}
      <div className="mt" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={filtro === 'aberto' ? 'ouro' : 'secundario'} onClick={() => setFiltro('aberto')}>Em aberto ({abertos.length})</button>
        <button className={filtro === 'pago' ? 'ouro' : 'secundario'} onClick={() => setFiltro('pago')}>Pagos ({pagos.length})</button>
        <button className={filtro === 'todos' ? 'ouro' : 'secundario'} onClick={() => setFiltro('todos')}>Todos</button>
      </div>

      {erro && <div className="erro">{erro}</div>}

      {/* Barra de ação em massa */}
      {sel.size > 0 && (
        <div className="card mt" style={{
          position: 'sticky', top: 8, zIndex: 5, borderColor: 'var(--cor-ouro)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'
        }}>
          <strong style={{ flex: 1, minWidth: 160 }}>{sel.size} selecionado(s) · {formatarMoeda(selTotal)}</strong>
          <div>
            <label style={{ fontSize: '.75rem' }}>Data do recebimento (opcional)</label>
            <input type="date" value={dataReceb} onChange={e => setDataReceb(e.target.value)} placeholder="hoje" />
          </div>
          <button className="secundario" onClick={() => setSel(new Set())}>Limpar</button>
          <button className="ouro" disabled={salvandoMassa} onClick={receberSelecionados}>
            {salvandoMassa ? 'Salvando…' : `✓ Marcar recebido(s)`}
          </button>
        </div>
      )}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : visiveis.length === 0 ? (
        <div className="card mt">
          <strong>{filtro === 'pago' ? 'Nenhum recebimento pago' : filtro === 'aberto' ? 'Tudo em dia 🎉' : 'Nada nesta competência'}</strong>
          <p className="sub" style={{ marginBottom: 0 }}>
            {filtro === 'aberto'
              ? `Nenhum contrato vigente em aberto para ${formatarCompetencia(competenciaISO(competencia))}.`
              : 'Registre um recebimento ou mude a competência.'}
          </p>
        </div>
      ) : (
        <>
          {/* Selecionar todos (só quando há abertos visíveis) */}
          {filtro !== 'pago' && selecionaveis.length > 0 && (
            <label className="mt" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.85rem' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={todosSelecionados} onChange={alternarTodos} />
              Selecionar todos os {selecionaveis.length} em aberto
            </label>
          )}

          <div className="mt" style={{ display: 'grid', gap: 10 }}>
            {visiveis.map(l => {
              const tag = l.pago ? { t: 'Pago', cor: '#22c55e' } : TAG[l.estagio]
              const cobradoEm = log[`${l.key}|${competencia}`]
              const selecionavel = !l.pago && !!l.contrato
              return (
                <div key={l.key} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderLeft: `4px solid ${tag.cor}` }}>
                  {selecionavel && (
                    <input type="checkbox" style={{ width: 'auto' }} checked={sel.has(l.key)} onChange={() => alternarSel(l.key)} />
                  )}
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong>{l.nome}</strong>
                      <span className="tag" style={{ background: tag.cor + '22', color: tag.cor, border: `1px solid ${tag.cor}55` }}>
                        {tag.t}{l.estagio === 'atrasado' ? ` ${l.diasAtraso}d` : (!l.pago && l.dias > 0 ? ` · ${l.dias}d` : '')}
                      </span>
                      {l.rec?.recibo_numero != null && <span className="tag" style={{ background: 'var(--surface-2)' }}>recibo {String(l.rec.recibo_numero).padStart(4, '0')}</span>}
                      {cobradoEm && !l.pago && <span className="tag" style={{ background: 'var(--surface-2)' }}>cobrado {formatarData(cobradoEm)}</span>}
                    </div>
                    <div className="sub" style={{ margin: '4px 0 0' }}>
                      {l.local} · {formatarMoeda(l.valor)}
                      {!l.pago && l.total > l.valor ? ` → total ${formatarMoeda(l.total)}` : ''}
                      {l.pago && l.rec?.forma ? ` · ${FORMAS[l.rec.forma] || l.rec.forma}` : ''}
                      {!l.pago && (l.vencimento ? ` · vence ${formatarData(l.vencimento.toISOString())}` : ' · sem dia de vencimento')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {!l.pago && l.contrato && <button className="ouro" disabled={salvandoMassa} onClick={() => receberContratos([l])}>Receber</button>}
                    {!l.pago && <button className="secundario" onClick={() => cobrar(l)} title="Cobrar no WhatsApp">💬 Cobrar</button>}
                    {pixConfigurado && <button className="secundario" onClick={() => abrirPix(l)} title="PIX QR / copia e cola">PIX</button>}
                    {l.pago && l.rec && <button className="secundario" onClick={() => baixarRecibo(l.rec)} title="Baixar recibo PDF">Recibo</button>}
                    {l.pago && l.rec && <button className="secundario" onClick={() => whatsappSimples(l.nome, l.tel, l.valor)} title="WhatsApp">💬</button>}
                    {l.rec && <button className="secundario" onClick={() => abrirEdicao(l.rec)}>Editar</button>}
                    {l.rec && <button className="secundario" onClick={() => excluir(l.rec)} title="Excluir">🗑</button>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Modal de registro manual */}
      {editando && (
        <Modal titulo={editando.id ? 'Editar recebimento' : 'Registrar recebimento'} onFechar={() => setEditando(null)}>
          <form onSubmit={salvar}>
            {!editando.id && (
              <>
                <label>Contrato *</label>
                <select value={editando.contrato_id} onChange={e => escolherContrato(e.target.value)}>
                  <option value="">— escolher —</option>
                  {contratos.map(c => {
                    const casa = c.quartos?.casas?.nome ? `${c.quartos.casas.nome} · ` : ''
                    return <option key={c.id} value={c.id}>{c.inquilinos?.nome} — {casa}{c.quartos?.identificacao}</option>
                  })}
                </select>
              </>
            )}

            <div className="linha">
              <div>
                <label>Competência (mês)</label>
                <input type="month" value={editando.competencia}
                       onChange={e => setEditando({ ...editando, competencia: e.target.value })} />
              </div>
              <div>
                <label>Valor (R$)</label>
                <input inputMode="decimal" value={editando.valor}
                       onChange={e => setEditando({ ...editando, valor: e.target.value })} placeholder="0,00" />
              </div>
            </div>

            <div className="linha">
              <div>
                <label>Forma</label>
                <select value={editando.forma} onChange={e => setEditando({ ...editando, forma: e.target.value })}>
                  {Object.entries(FORMAS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </div>
              <div>
                <label>Status</label>
                <select value={editando.status} onChange={e => setEditando({ ...editando, status: e.target.value })}>
                  {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {editando.status === 'pago' && (
              <>
                <label>Data do pagamento</label>
                <input type="date" value={editando.pago_data}
                       onChange={e => setEditando({ ...editando, pago_data: e.target.value })} />
                <p className="sub" style={{ marginTop: 6 }}>Ao salvar como <b>Pago</b>, o sistema reserva o número do recibo automaticamente.</p>
              </>
            )}

            <label>Observações</label>
            <textarea rows={2} value={editando.observacoes || ''}
                      onChange={e => setEditando({ ...editando, observacoes: e.target.value })} />

            {erro && <div className="erro">{erro}</div>}

            <div className="linha mt">
              <button type="button" className="secundario" onClick={() => setEditando(null)}>Cancelar</button>
              <button type="submit" className="ouro">Salvar</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal PIX */}
      {pix && (
        <Modal titulo="Cobrança PIX" onFechar={() => setPix(null)}>
          <div style={{ textAlign: 'center' }}>
            <img src={pix.qr} alt="QR PIX" style={{ width: 220, height: 220, maxWidth: '100%' }} />
            <p className="sub" style={{ margin: '6px 0' }}>{formatarMoeda(pix.valor)} · {pix.nome}</p>
          </div>
          <label>PIX copia e cola</label>
          <textarea readOnly rows={3} value={pix.brcode} onFocus={e => e.target.select()}
                    style={{ fontFamily: 'monospace', fontSize: '.8rem' }} />
          <div className="linha mt" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="secundario" onClick={() => copiar(pix.brcode)}>Copiar código</button>
            <button type="button" className="secundario" onClick={() => whatsappSimples(pix.nome, pix.tel, pix.valor)}>💬 Enviar</button>
            <button type="button" className="ouro" onClick={() => setPix(null)}>Fechar</button>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>
            QR estático não confirma o pagamento automaticamente — confirme pelo comprovante e marque como <b>Recebido</b>.
          </p>
        </Modal>
      )}
    </div>
  )
}
