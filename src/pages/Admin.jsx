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

  async function definir(org, situacao, expira) {
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
    <div className="stack">
      <div>
        <h1>Administração</h1>
        <div className="sub">Controle de acesso dos clientes (liberar, renovar e suspender).</div>
      </div>
      {erro && <div className="erro">{erro}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.92rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--texto-fraco)' }}>
              <th style={th}>Cliente</th>
              <th style={th}>Situação</th>
              <th style={th}>Vence em</th>
              <th style={th}>Casas</th>
              <th style={th}>Contratos</th>
              <th style={th}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map(o => {
              const s = SIT[o.situacao] || SIT.trial
              const emBusy = busy === o.id
              return (
                <tr key={o.id} style={{ borderTop: '1px solid var(--borda)' }}>
                  <td style={td}><strong>{o.nome || '(sem nome)'}</strong></td>
                  <td style={td}>
                    <span style={{ background: s.bg, color: s.cor, padding: '2px 9px', borderRadius: 999, fontSize: '.8rem', fontWeight: 600 }}>
                      {s.txt}
                    </span>
                  </td>
                  <td style={td}>{o.acesso_expira_em ? formatarData(o.acesso_expira_em) : '—'}</td>
                  <td style={td}>{o.casas}</td>
                  <td style={td}>{o.contratos_ativos}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button className="secundario" disabled={emBusy}
                      onClick={() => definir(o, 'ativa', isoMais(365, o.acesso_expira_em))}
                      title="Ativa e soma 1 ano ao vencimento">+1 ano</button>{' '}
                    <button className="secundario" disabled={emBusy}
                      onClick={() => definir(o, 'ativa', venceEm(30))}
                      title="Ativa por 30 dias a partir de hoje">30 dias</button>{' '}
                    {o.situacao === 'suspensa'
                      ? <button className="secundario" disabled={emBusy}
                          onClick={() => definir(o, 'ativa', o.acesso_expira_em)}>Reativar</button>
                      : <button className="secundario" disabled={emBusy}
                          onClick={() => definir(o, 'suspensa', o.acesso_expira_em)}>Suspender</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const th = { padding: '8px 10px', fontWeight: 600 }
const td = { padding: '10px' }
