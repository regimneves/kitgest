import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, formatarData } from '../lib/format'
import { lerConfig, mesAtual, competenciaISO, vencimentoNaCompetencia, diasAte, hoje0 } from '../lib/gestao'

const VIGENTE = new Set(['ativo', 'inadimplente', 'pendente'])

export default function Alertas() {
  const { org } = useOrg()
  const cfg = useMemo(() => lerConfig(org), [org])
  const [contratos, setContratos] = useState([])
  const [recebPagos, setRecebPagos] = useState(new Set())
  const [quartos, setQuartos] = useState([])
  const [manut, setManut] = useState([])
  const [contas, setContas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const comp = competenciaISO(mesAtual())
    const [{ data: cts, error }, { data: rs }, { data: qs }, { data: ms }, { data: cp }] = await Promise.all([
      supabase.from('contratos')
        .select('id, status, data_fim, dia_vencimento, valor_aluguel, inquilinos(nome), quartos(identificacao, casas(nome))')
        .in('status', ['ativo', 'inadimplente', 'pendente']),
      supabase.from('recebimentos').select('contrato_id, status').eq('competencia', comp),
      supabase.from('quartos').select('id, identificacao, status, atualizado_em, casas(nome)'),
      supabase.from('manutencao').select('id, titulo, status, aberto_em, casas(nome)').neq('status', 'concluida'),
      supabase.from('contas_pagar').select('id, tipo, valor, vencimento, casas(nome)').eq('pago', false)
    ])
    if (error) setErro(error.message)
    setContratos(cts || [])
    const pagos = new Set()
    for (const r of rs || []) if (r.status === 'pago') pagos.add(r.contrato_id)
    setRecebPagos(pagos)
    setQuartos(qs || []); setManut(ms || []); setContas(cp || [])
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const grupos = useMemo(() => {
    const mes = mesAtual()
    const hoje = hoje0()
    const out = []

    // 1) Inadimplência: vigentes sem recebimento pago no mês e já vencidos
    const inad = contratos.filter(c => {
      if (recebPagos.has(c.id)) return false
      const v = vencimentoNaCompetencia(c.dia_vencimento, mes)
      return v && v < hoje
    })
    if (inad.length) out.push({
      chave: 'inad', cor: '#ef4444', titulo: 'Inadimplência',
      resumo: `${inad.length} contrato(s) vencido(s) sem pagamento — ${formatarMoeda(inad.reduce((s, c) => s + Number(c.valor_aluguel || 0), 0))}`,
      itens: inad.map(c => `${c.inquilinos?.nome || 'Inquilino'} · ${loc(c)}`),
      rota: '/cobranca', acao: 'Ir para Cobrança'
    })

    // 2) Contratos vencendo (data_fim dentro do limiar)
    const venc = contratos.filter(c => {
      if (!c.data_fim) return false
      const d = diasAte(new Date(c.data_fim + 'T00:00:00'))
      return d != null && d >= 0 && d <= cfg.alertas.contrato_vencendo_dias
    }).sort((a, b) => new Date(a.data_fim) - new Date(b.data_fim))
    if (venc.length) out.push({
      chave: 'venc', cor: '#f97316', titulo: 'Contratos vencendo',
      resumo: `${venc.length} contrato(s) vencem nos próximos ${cfg.alertas.contrato_vencendo_dias} dias`,
      itens: venc.map(c => `${c.inquilinos?.nome || 'Inquilino'} · ${loc(c)} · vence ${formatarData(c.data_fim)}`),
      rota: '/reajustes', acao: 'Renovar / reajustar'
    })

    // 3) Contas a pagar vencidas
    const contasVencidas = contas.filter(c => c.vencimento && new Date(c.vencimento + 'T00:00:00') < hoje)
    if (contasVencidas.length) out.push({
      chave: 'contas', cor: '#ef4444', titulo: 'Contas a pagar vencidas',
      resumo: `${contasVencidas.length} conta(s) vencida(s) — ${formatarMoeda(contasVencidas.reduce((s, c) => s + Number(c.valor || 0), 0))}`,
      itens: contasVencidas.map(c => `${c.casas?.nome ? c.casas.nome + ' · ' : ''}${tipoLabel(c.tipo)} · ${formatarMoeda(c.valor)} · venceu ${formatarData(c.vencimento)}`),
      rota: '/contas-pagar', acao: 'Ir para Contas a pagar'
    })

    // 4) Manutenções paradas (abertas há mais que o limiar)
    const paradas = manut.filter(m => {
      const d = diasAte(new Date(m.aberto_em))
      return d != null && (-d) >= cfg.alertas.manutencao_parada_dias
    })
    if (paradas.length) out.push({
      chave: 'manut', cor: '#eab308', titulo: 'Manutenções paradas',
      resumo: `${paradas.length} ordem(ns) aberta(s) há mais de ${cfg.alertas.manutencao_parada_dias} dias`,
      itens: paradas.map(m => `${m.titulo}${m.casas?.nome ? ' · ' + m.casas.nome : ''} · desde ${formatarData(new Date(m.aberto_em).toISOString())}`),
      rota: '/manutencao', acao: 'Ir para Manutenção'
    })

    // 5) Quartos vagos há muito tempo (proxy: atualizado_em)
    const vagos = quartos.filter(q => q.status === 'vago').map(q => {
      const d = diasAte(new Date(q.atualizado_em))
      return { q, dias: d != null ? -d : 0 }
    })
    const vagosVelhos = vagos.filter(v => v.dias >= cfg.alertas.vaga_dias)
    if (vagosVelhos.length) out.push({
      chave: 'vagos', cor: '#3b82f6', titulo: 'Quartos vagos',
      resumo: `${vagosVelhos.length} quarto(s) vago(s) há mais de ${cfg.alertas.vaga_dias} dias (custo do aluguel-mãe continua correndo)`,
      itens: vagosVelhos.map(v => `${v.q.casas?.nome ? v.q.casas.nome + ' · ' : ''}${v.q.identificacao} · vago há ~${v.dias} dias`),
      rota: '/casas', acao: 'Ver quartos'
    })

    return out
  }, [contratos, recebPagos, quartos, manut, contas, cfg])

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Alertas</h1>
          <p className="sub" style={{ margin: 0 }}>O que precisa da sua atenção agora. Limiares ajustáveis em Configuração.</p>
        </div>
      </div>

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : grupos.length === 0 ? (
        <div className="card mt">
          <strong>Tudo em ordem ✅</strong>
          <p className="sub" style={{ marginBottom: 0 }}>Nenhum alerta no momento: sem inadimplência, contas vencidas, contratos vencendo ou manutenções paradas.</p>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 12 }}>
          {grupos.map(g => (
            <div key={g.chave} className="card" style={{ borderLeft: `4px solid ${g.cor}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ flex: 1 }}>{g.titulo}</strong>
                <Link to={g.rota}><button className="secundario" style={{ padding: '6px 12px' }}>{g.acao} →</button></Link>
              </div>
              <p className="sub" style={{ margin: '6px 0 8px', color: g.cor }}>{g.resumo}</p>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--texto-fraco)', fontSize: '.88rem' }}>
                {g.itens.slice(0, 6).map((t, i) => <li key={i} style={{ margin: '2px 0' }}>{t}</li>)}
                {g.itens.length > 6 && <li>e mais {g.itens.length - 6}…</li>}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function loc(c) {
  const q = c.quartos
  return q ? `${q.casas?.nome ? q.casas.nome + ' · ' : ''}${q.identificacao}` : '—'
}
function tipoLabel(t) {
  return ({ aluguel_mae: 'Aluguel da casa', energia: 'Energia', agua: 'Água', gas: 'Gás', internet: 'Internet', iptu: 'IPTU', limpeza: 'Limpeza', seguro: 'Seguro', funcionario: 'Funcionário', outro: 'Outro' })[t] || t
}
