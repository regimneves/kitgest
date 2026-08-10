import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { formatarMoeda, formatarCompetencia } from '../lib/format'
import { mesAtual, competenciaISO } from '../lib/gestao'

const GERAL = '__geral__'

export default function FluxoCaixa() {
  const [casas, setCasas] = useState([])
  const [recebimentos, setRecebimentos] = useState([])
  const [contas, setContas] = useState([])
  const [manut, setManut] = useState([])
  const [competencia, setCompetencia] = useState(mesAtual())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const comp = competenciaISO(competencia)
    const [{ data: cs, error }, { data: rs }, { data: cp }, { data: ms }] = await Promise.all([
      supabase.from('casas').select('id, nome').order('nome'),
      supabase.from('recebimentos').select('valor, status, quartos(casa_id)').eq('competencia', comp),
      supabase.from('contas_pagar').select('valor, pago, casa_id').eq('competencia', comp),
      supabase.from('manutencao').select('custo, casa_id, concluido_em')
    ])
    if (error) setErro(error.message)
    setCasas(cs || []); setRecebimentos(rs || []); setContas(cp || []); setManut(ms || [])
    setCarregando(false)
  }, [competencia])

  useEffect(() => { carregar() }, [carregar])

  // Manutenção que entra no mês: concluída dentro da competência (custo realizado).
  const manutDoMes = useMemo(() => {
    return manut.filter(m => {
      if (!(Number(m.custo) > 0) || !m.concluido_em) return false
      return String(m.concluido_em).slice(0, 7) === competencia
    })
  }, [manut, competencia])

  // Agrega por casa (+ bucket geral).
  const porCasa = useMemo(() => {
    const mapa = {}
    const get = (id) => (mapa[id] ||= { entrada: 0, contas: 0, manut: 0 })
    for (const r of recebimentos) {
      if (r.status !== 'pago') continue
      get(r.quartos?.casa_id || GERAL).entrada += Number(r.valor || 0)
    }
    for (const c of contas) get(c.casa_id || GERAL).contas += Number(c.valor || 0)
    for (const m of manutDoMes) get(m.casa_id || GERAL).manut += Number(m.custo || 0)
    return mapa
  }, [recebimentos, contas, manutDoMes])

  const linhas = useMemo(() => {
    const arr = casas.map(c => {
      const a = porCasa[c.id] || { entrada: 0, contas: 0, manut: 0 }
      const saida = a.contas + a.manut
      return { id: c.id, nome: c.nome, ...a, saida, resultado: a.entrada - saida }
    })
    if (porCasa[GERAL]) {
      const a = porCasa[GERAL]
      const saida = a.contas + a.manut
      arr.push({ id: GERAL, nome: 'Geral / sem casa', ...a, saida, resultado: a.entrada - saida })
    }
    return arr
  }, [casas, porCasa])

  const kpi = useMemo(() => {
    const recebido = recebimentos.filter(r => r.status === 'pago').reduce((s, r) => s + Number(r.valor || 0), 0)
    const esperado = recebimentos.reduce((s, r) => s + Number(r.valor || 0), 0)
    const contasTotal = contas.reduce((s, c) => s + Number(c.valor || 0), 0)
    const contasPagas = contas.filter(c => c.pago).reduce((s, c) => s + Number(c.valor || 0), 0)
    const manutTotal = manutDoMes.reduce((s, m) => s + Number(m.custo || 0), 0)
    const saidas = contasTotal + manutTotal
    return {
      recebido, aReceber: Math.max(0, esperado - recebido),
      saidas, contasTotal, manutTotal, aPagar: Math.max(0, contasTotal - contasPagas),
      resultado: recebido - saidas
    }
  }, [recebimentos, contas, manutDoMes])

  if (carregando) return <p className="sub">Carregando…</p>

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h1>Fluxo de caixa</h1>
          <p className="sub" style={{ margin: 0 }}>Entradas − saídas = lucro do mês. Entradas = recebimentos pagos; saídas = contas a pagar + manutenção.</p>
        </div>
        <div>
          <label style={{ fontSize: '.8rem' }}>Competência</label>
          <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} />
        </div>
      </div>

      {erro && <div className="erro">{erro}</div>}

      <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Kpi titulo="Entradas (recebido)" valor={formatarMoeda(kpi.recebido)} cor="#22c55e" sub={`a receber ${formatarMoeda(kpi.aReceber)}`} />
        <Kpi titulo="Saídas" valor={formatarMoeda(kpi.saidas)} cor="#ef4444" sub={`contas ${formatarMoeda(kpi.contasTotal)} · manut. ${formatarMoeda(kpi.manutTotal)}`} />
        <Kpi titulo={`Resultado ${formatarCompetencia(competenciaISO(competencia))}`} valor={formatarMoeda(kpi.resultado)}
             cor={kpi.resultado < 0 ? '#ef4444' : '#22c55e'} sub="lucro do mês" />
        <Kpi titulo="Ainda a pagar" valor={formatarMoeda(kpi.aPagar)} cor={kpi.aPagar > 0 ? '#f97316' : '#22c55e'} sub="contas em aberto" />
      </div>

      <h1 style={{ fontSize: '1.2rem', marginTop: 22 }}>Resultado por casa</h1>
      <p className="sub" style={{ marginTop: 0 }}>Qual casa está dando mais lucro no mês.</p>
      <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
        <table style={tab}>
          <thead><tr style={trh}>
            <th style={th}>Casa</th><th style={thR}>Entradas</th><th style={thR}>Contas</th>
            <th style={thR}>Manutenção</th><th style={thR}>Saídas</th><th style={thR}>Resultado</th>
          </tr></thead>
          <tbody>
            {linhas.map(l => (
              <tr key={l.id} style={trb}>
                <td style={td}>{l.nome}</td>
                <td style={{ ...tdR, color: '#22c55e' }}>{formatarMoeda(l.entrada)}</td>
                <td style={tdR}>{formatarMoeda(l.contas)}</td>
                <td style={tdR}>{formatarMoeda(l.manut)}</td>
                <td style={{ ...tdR, color: '#ef4444' }}>{formatarMoeda(l.saida)}</td>
                <td style={{ ...tdR, fontWeight: 700, color: l.resultado < 0 ? '#ef4444' : '#22c55e' }}>{formatarMoeda(l.resultado)}</td>
              </tr>
            ))}
            {linhas.length === 0 && <tr><td style={td} colSpan={6}><span className="sub">Sem movimento neste mês.</span></td></tr>}
          </tbody>
          {linhas.length > 0 && (
            <tfoot><tr>
              <td style={{ ...td, fontWeight: 700 }}>Total</td>
              <td style={{ ...tdR, fontWeight: 700, color: '#22c55e' }}>{formatarMoeda(kpi.recebido)}</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{formatarMoeda(kpi.contasTotal)}</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{formatarMoeda(kpi.manutTotal)}</td>
              <td style={{ ...tdR, fontWeight: 700, color: '#ef4444' }}>{formatarMoeda(kpi.saidas)}</td>
              <td style={{ ...tdR, fontWeight: 700, color: kpi.resultado < 0 ? '#ef4444' : '#22c55e' }}>{formatarMoeda(kpi.resultado)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
      <p className="sub mt">
        Dica: registre o aluguel das casas e as despesas em <b>Contas a pagar</b> (botão “Gerar contas do mês”) para o resultado sair completo.
      </p>
    </div>
  )
}

function Kpi({ titulo, valor, sub, cor }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="sub" style={{ fontSize: '.78rem' }}>{titulo}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, margin: '2px 0', color: cor || 'inherit' }}>{valor}</div>
      {sub && <div className="sub" style={{ fontSize: '.72rem' }}>{sub}</div>}
    </div>
  )
}

const tab = { width: '100%', borderCollapse: 'collapse', minWidth: 560 }
const trh = { textAlign: 'left', borderBottom: '1px solid var(--borda)' }
const trb = { borderBottom: '1px solid var(--borda)' }
const th = { padding: '10px 12px', fontSize: '.82rem', color: 'var(--texto-fraco)' }
const thR = { ...th, textAlign: 'right' }
const td = { padding: '10px 12px' }
const tdR = { ...td, textAlign: 'right' }
