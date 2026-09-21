import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { formatarData } from '../lib/format'

const SIT = {
  trial:    { txt: 'Teste',     cor: '#b47f08', bg: '#fbf3dd' },
  ativa:    { txt: 'Ativa',     cor: '#2f8f5b', bg: '#e6f3ea' },
  suspensa: { txt: 'Suspensa',  cor: '#c0492f', bg: '#f8e8e3' },
}

function isoMais(dias, base) {
  const d = base ? new Date(base + 'T00:00:00') : new Date()
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  // estende a partir do maior entre hoje e o vencimento atual
  const partida = d > hoje ? d : hoje
  partida.setDate(partida.getDate() + dias)
  return partida.toISOString().slice(0, 10)
}
function venceEm(dias) {
  const d = new Date(); d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

export default function Admin() {
  const [orgs, setOrgs] = useState(null)
  const [erro, setErro] = useState('')
  const [busy, setBusy] = useState('')

  const carregar = useCallback(async () => {
    setErro('')
    const { data, error } = await supabase.rpc('admin_listar_orgs')
    if (error) { setErro(error.message); setOrgs([]); return }
    setOrgs(data || [])
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function definir(org, situacao, expira, aviso) {
    if (aviso && !window.confirm(aviso)) return
    setBusy(org.id)
    const { error } = await supabase.rpc('admin_definir_acesso', {
      p_org: org.id, p_situacao: situacao, p_expira: expira,
    })
    setBusy('')
    if (error) { alert('Erro: ' + error.message); return }
    carregar()
  }

  if (orgs === null) return <div className="sub">Carregando clientes…</div>

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div>
        <h1>Administração</h1>
        <div className="sub" style={{ margin: '4px 0 16px' }}>
          Controle de acesso dos clientes — liberar, renovar e suspender. {orgs.length} conta(s).
        </div>
      </div>
      {erro && <div className="erro">{erro}</div>}

      <div style={{ display: 'grid', gap: 12 }}>
        {orgs.map(o => {
          const s = SIT[o.situacao] || SIT.trial
          const emBusy = busy === o.id
          return (
            <div key={o.id} className="card" style={{ padding: 16, display: 'grid', gap: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ flex: 1, minWidth: 140, fontSize: '1.02rem' }}>{o.nome || '(sem nome)'}</strong>
                <span style={{ background: s.bg, color: s.cor, padding: '3px 11px', borderRadius: 999, fontSize: '.78rem', fontWeight: 700 }}>
                  {s.txt}
                </span>
              </div>

              <div className="sub" style={{ margin: 0, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>Vence: <b style={{ color: 'var(--texto)' }}>{o.acesso_expira_em ? formatarData(o.acesso_expira_em) : '—'}</b></span>
                <span>Casas: <b style={{ color: 'var(--texto)' }}>{o.casas}</b></span>
                <span>Contratos: <b style={{ color: 'var(--texto)' }}>{o.contratos_ativos}</b></span>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="ouro" disabled={emBusy}
                  onClick={() => definir(o, 'ativa', isoMais(365, o.acesso_expira_em))}
                  title="Ativa e soma 1 ano ao vencimento">+1 ano</button>
                <button className="secundario" disabled={emBusy}
                  onClick={() => definir(o, 'ativa', venceEm(30))}
                  title="Ativa por 30 dias a partir de hoje">30 dias</button>
                {o.situacao === 'suspensa'
                  ? <button className="secundario" disabled={emBusy}
                      onClick={() => definir(o, 'ativa', o.acesso_expira_em)}>Reativar</button>
                  : <button className="secundario" disabled={emBusy}
                      style={{ color: '#f0a58f' }}
                      onClick={() => definir(o, 'suspensa', o.acesso_expira_em,
                        `Suspender o acesso de "${o.nome || 'esta conta'}"? Ela deixa de usar o sistema até você reativar.`)}>
                      Suspender</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
