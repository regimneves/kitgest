import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatarMoeda, formatarCompetencia } from '../lib/format'

const VIGENTE = new Set(['ativo', 'inadimplente', 'pendente'])
const mesAtual = () => new Date().toISOString().slice(0, 7)

export default function Relatorios() {
  const [casas, setCasas] = useState([])
  const [quartos, setQuartos] = useState([])
  const [contratos, setContratos] = useState([])
  const [despesas, setDespesas] = useState([])
  const [recebimentos, setRecebimentos] = useState([])
  const [competencia, setCompetencia] = useState(mesAtual())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregarBase = useCallback(async () => {
    const [{ data: cs, error: e1 }, { data: qs }, { data: cts }, { data: ds }] = await Promise.all([
      supabase.from('casas').select('id, nome, aluguel_mae').order('nome'),
      supabase.from('quartos').select('id, casa_id, identificacao, valor_final, aluguel_base, status'),
      supabase.from('contratos')
        .select('id, quarto_id, valor_aluguel, dia_vencimento, status, inquilinos(nome), quartos(casa_id)')
        .in('status', ['ativo', 'inadimplente', 'pendente']),
      supabase.from('despesas_casa').select('casa_id, valor, recorrente, competencia')
    ])
    if (e1) setErro(e1.message)
    setCasas(cs || []); setQuartos(qs || []); setContratos(cts || []); setDespesas(ds || [])
  }, [])

  const carregarReceb = useCallback(async () => {
    const comp = `${competencia}-01`
    const { data } = await supabase.from('recebimentos')
      .select('contrato_id, valor, status').eq('competencia', comp)
    setRecebimentos(data || [])
  }, [competencia])

  useEffect(() => {
    (async () => { setCarregando(true); await carregarBase(); await carregarReceb(); setCarregando(false) })()
  }, [carregarBase, carregarReceb])
  useEffect(() => { carregarReceb() }, [carregarReceb])

  // Contrato vigente por quarto
  const contratoPorQuarto = useMemo(() => {
    const m = {}
    for (const c of contratos) if (VIGENTE.has(c.status)) m[c.quarto_id] = c
    return m
  }, [contratos])

  // Despesas recorrentes (custo mensal) por casa
  const despesaMensalPorCasa = useMemo(() => {
    const m = {}
    for (const d of despesas) {
      if (d.recorrente) m[d.casa_id] = (m[d.casa_id] || 0) + Number(d.valor || 0)
    }
    return m
  }, [despesas])

  // KPIs gerais
  const kpi = useMemo(() => {
    const totalQuartos = quartos.length
    const ocupados = quartos.filter(q => contratoPorQuarto[q.id]).length
    const receitaPotencial = quartos.reduce((s, q) => s + Number(q.valor_final || 0), 0)
    const receitaOcupada = quartos.reduce((s, q) => {
      const c = contratoPorQuarto[q.id]
      return s + (c ? Number(c.valor_aluguel || 0) : 0)
    }, 0)
    const aluguelMae = casas.reduce((s, c) => s + Number(c.aluguel_mae || 0), 0)
    const despesaMensal = Object.values(despesaMensalPorCasa).reduce((s, v) => s + v, 0)
    const margemPotencial = receitaPotencial - aluguelMae - despesaMensal
    const margemAtual = receitaOcupada - aluguelMae - despesaMensal
    // financeiro do mês
    const esperado = contratos.reduce((s, c) => s + Number(c.valor_aluguel || 0), 0)
    const recebido = recebimentos.filter(r => r.status === 'pago').reduce((s, r) => s + Number(r.valor || 0), 0)
    const emAberto = Math.max(0, esperado - recebido)
    return {
      totalQuartos, ocupados, vagos: totalQuartos - ocupados,
      ocupacao: totalQuartos ? Math.round((ocupados / totalQuartos) * 100) : 0,
      receitaPotencial, receitaOcupada, aluguelMae, despesaMensal, margemPotencial, margemAtual,
      esperado, recebido, emAberto
    }
  }, [quartos, contratoPorQuarto, casas, despesaMensalPorCasa, contratos, recebimentos])

  // Margem por casa
  const margemCasas = useMemo(() => casas.map(casa => {
    const qs = quartos.filter(q => q.casa_id === casa.id)
    const receitaPot = qs.reduce((s, q) => s + Number(q.valor_final || 0), 0)
    const receitaOcup = qs.reduce((s, q) => {
      const c = contratoPorQuarto[q.id]; return s + (c ? Number(c.valor_aluguel || 0) : 0)
    }, 0)
    const mae = Number(casa.aluguel_mae || 0)
    const desp = despesaMensalPorCasa[casa.id] || 0
    const ocup = qs.filter(q => contratoPorQuarto[q.id]).length
    return {
      id: casa.id, nome: casa.nome, nQuartos: qs.length, ocupados: ocup,
      mae, desp, receitaPot, receitaOcup,
      margemPot: receitaPot - mae - desp, margemAtual: receitaOcup - mae - desp
    }
  }), [casas, quartos, contratoPorQuarto, despesaMensalPorCasa])

  // Inadimplência: contratos vigentes sem recebimento PAGO na competência
  const pagosPorContrato = useMemo(() => {
    const s = new Set()
    for (const r of recebimentos) if (r.status === 'pago') s.add(r.contrato_id)
    return s
  }, [recebimentos])
  const inadimplentes = useMemo(() =>
    contratos.filter(c => !pagosPorContrato.has(c.id)), [contratos, pagosPorContrato])

  const nomeCasa = (id) => casas.find(c => c.id === id)?.nome || ''

  if (carregando) return <p className="sub">Carregando…</p>

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h1>Relatórios</h1>
          <p className="sub" style={{ margin: 0 }}>Rent roll, margem da sublocação e inadimplência (retaguarda).</p>
        </div>
        <div>
          <label style={{ fontSize: '.8rem' }}>Competência</label>
          <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} />
        </div>
      </div>

      {erro && <div className="erro">{erro}</div>}

      {/* KPIs */}
      <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Kpi titulo="Ocupação" valor={`${kpi.ocupacao}%`} sub={`${kpi.ocupados}/${kpi.totalQuartos} quartos`} />
        <Kpi titulo="Receita potencial" valor={formatarMoeda(kpi.receitaPotencial)} sub="todos os quartos/mês" />
        <Kpi titulo="Receita atual" valor={formatarMoeda(kpi.receitaOcupada)} sub="contratos vigentes" />
        <Kpi titulo="Margem atual" valor={formatarMoeda(kpi.margemAtual)} sub="receita − mãe − despesas"
             cor={kpi.margemAtual < 0 ? '#ef4444' : '#22c55e'} />
        <Kpi titulo={`Recebido ${formatarCompetencia(`${competencia}-01`)}`} valor={formatarMoeda(kpi.recebido)} sub={`esperado ${formatarMoeda(kpi.esperado)}`} />
        <Kpi titulo="Em aberto no mês" valor={formatarMoeda(kpi.emAberto)} sub={`${inadimplentes.length} contrato(s)`}
             cor={kpi.emAberto > 0 ? '#ef4444' : '#22c55e'} />
      </div>

      {/* Margem por casa */}
      <h1 style={{ fontSize: '1.2rem', marginTop: 22 }}>Margem da sublocação</h1>
      <p className="sub" style={{ marginTop: 0 }}>Receita cobrada − aluguel-mãe − despesas recorrentes do mês.</p>
      <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
        <table style={tab}>
          <thead><tr style={trh}>
            <th style={th}>Casa</th><th style={thC}>Ocup.</th><th style={thR}>Aluguel-mãe</th>
            <th style={thR}>Despesas</th><th style={thR}>Receita pot.</th><th style={thR}>Margem pot.</th><th style={thR}>Margem atual</th>
          </tr></thead>
          <tbody>
            {margemCasas.map(m => (
              <tr key={m.id} style={trb}>
                <td style={td}>{m.nome}</td>
                <td style={tdC}>{m.ocupados}/{m.nQuartos}</td>
                <td style={tdR}>{formatarMoeda(m.mae)}</td>
                <td style={tdR}>{formatarMoeda(m.desp)}</td>
                <td style={tdR}>{formatarMoeda(m.receitaPot)}</td>
                <td style={{ ...tdR, color: m.margemPot < 0 ? '#ef4444' : 'inherit' }}>{formatarMoeda(m.margemPot)}</td>
                <td style={{ ...tdR, fontWeight: 700, color: m.margemAtual < 0 ? '#ef4444' : '#22c55e' }}>{formatarMoeda(m.margemAtual)}</td>
              </tr>
            ))}
            {margemCasas.length === 0 && <tr><td style={td} colSpan={7}><span className="sub">Nenhuma casa cadastrada.</span></td></tr>}
          </tbody>
          {margemCasas.length > 0 && (
            <tfoot><tr>
              <td style={{ ...td, fontWeight: 700 }}>Total</td><td style={tdC}></td>
              <td style={{ ...tdR, fontWeight: 700 }}>{formatarMoeda(kpi.aluguelMae)}</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{formatarMoeda(kpi.despesaMensal)}</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{formatarMoeda(kpi.receitaPotencial)}</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{formatarMoeda(kpi.margemPotencial)}</td>
              <td style={{ ...tdR, fontWeight: 700, color: kpi.margemAtual < 0 ? '#ef4444' : '#22c55e' }}>{formatarMoeda(kpi.margemAtual)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>

      {/* Inadimplência */}
      <h1 style={{ fontSize: '1.2rem', marginTop: 22 }}>
        Inadimplência · {formatarCompetencia(`${competencia}-01`)}
      </h1>
      <p className="sub" style={{ marginTop: 0 }}>Contratos vigentes sem recebimento pago neste mês.</p>
      {inadimplentes.length === 0 ? (
        <div className="card"><p className="sub" style={{ margin: 0 }}>
          {contratos.length === 0 ? 'Nenhum contrato vigente.' : '✅ Todos os contratos vigentes com recebimento no mês.'}
        </p></div>
      ) : (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={tab}>
            <thead><tr style={trh}>
              <th style={th}>Inquilino</th><th style={th}>Casa</th><th style={thC}>Vencimento</th><th style={thR}>Valor</th>
            </tr></thead>
            <tbody>
              {inadimplentes.map(c => (
                <tr key={c.id} style={trb}>
                  <td style={td}>{c.inquilinos?.nome || '—'}</td>
                  <td style={td}>{nomeCasa(c.quartos?.casa_id)}</td>
                  <td style={tdC}>{c.dia_vencimento ? `dia ${c.dia_vencimento}` : '—'}</td>
                  <td style={{ ...tdR, color: '#ef4444', fontWeight: 700 }}>{formatarMoeda(c.valor_aluguel)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td style={{ ...td, fontWeight: 700 }} colSpan={3}>Total em aberto</td>
              <td style={{ ...tdR, fontWeight: 700, color: '#ef4444' }}>{formatarMoeda(kpi.emAberto)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}

      {/* Rent roll */}
      <h1 style={{ fontSize: '1.2rem', marginTop: 22 }}>Rent roll</h1>
      <p className="sub" style={{ marginTop: 0 }}>Todos os quartos, status e o inquilino atual.</p>
      <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
        <table style={tab}>
          <thead><tr style={trh}>
            <th style={th}>Casa</th><th style={th}>Quarto</th><th style={thC}>Status</th><th style={th}>Inquilino</th><th style={thR}>Valor/mês</th>
          </tr></thead>
          <tbody>
            {quartos.map(q => {
              const c = contratoPorQuarto[q.id]
              const ocupado = !!c
              return (
                <tr key={q.id} style={trb}>
                  <td style={td}>{nomeCasa(q.casa_id)}</td>
                  <td style={td}>{q.identificacao}</td>
                  <td style={tdC}>
                    <span className="tag" style={{
                      background: (ocupado ? '#3b82f6' : '#22c55e') + '22',
                      color: ocupado ? '#3b82f6' : '#22c55e',
                      border: `1px solid ${(ocupado ? '#3b82f6' : '#22c55e')}55`
                    }}>{ocupado ? 'Ocupado' : 'Vago'}</span>
                  </td>
                  <td style={td}>{c?.inquilinos?.nome || <span className="sub">—</span>}</td>
                  <td style={tdR}>{formatarMoeda(ocupado ? c.valor_aluguel : q.valor_final)}</td>
                </tr>
              )
            })}
            {quartos.length === 0 && <tr><td style={td} colSpan={5}><span className="sub">Nenhum quarto cadastrado. <Link to="/casas">Comece pelas casas</Link>.</span></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Kpi({ titulo, valor, sub, cor }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="sub" style={{ fontSize: '.78rem' }}>{titulo}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, margin: '2px 0', color: cor || 'inherit' }}>{valor}</div>
      <div className="sub" style={{ fontSize: '.72rem' }}>{sub}</div>
    </div>
  )
}

const tab = { width: '100%', borderCollapse: 'collapse', minWidth: 520 }
const trh = { textAlign: 'left', borderBottom: '1px solid var(--borda)' }
const trb = { borderBottom: '1px solid var(--borda)' }
const th = { padding: '10px 12px', fontSize: '.82rem', color: 'var(--texto-fraco)' }
const thR = { ...th, textAlign: 'right' }
const thC = { ...th, textAlign: 'center' }
const td = { padding: '10px 12px' }
const tdR = { ...td, textAlign: 'right' }
const tdC = { ...td, textAlign: 'center' }
