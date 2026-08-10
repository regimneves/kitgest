import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, parseMoeda, formatarData } from '../lib/format'
import { diasAte } from '../lib/gestao'
import Modal from '../components/Modal'

const VIGENTE = ['ativo', 'inadimplente', 'pendente']
const INDICES = { igpm: 'IGP-M', ipca: 'IPCA', inpc: 'INPC', fixo: 'Fixo', outro: 'Outro' }

// Meses inteiros entre uma data e hoje.
function mesesDesde(iso) {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00'); const h = new Date()
  return (h.getFullYear() - d.getFullYear()) * 12 + (h.getMonth() - d.getMonth())
}

export default function Reajustes() {
  const { org } = useOrg()
  const [contratos, setContratos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [filtro, setFiltro] = useState('elegiveis') // elegiveis | todos
  const [editando, setEditando] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data, error } = await supabase.from('contratos')
      .select('id, valor_aluguel, data_inicio, data_fim, data_ultimo_reajuste, indice_reajuste, status, inquilinos(nome), quartos(identificacao, casas(nome))')
      .in('status', VIGENTE)
    if (error) setErro(error.message)
    setContratos(data || [])
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const linhas = useMemo(() => contratos.map(c => {
    const base = c.data_ultimo_reajuste || c.data_inicio
    const meses = mesesDesde(base)
    const elegivel = meses != null && meses >= 12         // reajuste anual disponível
    const diasFim = c.data_fim ? diasAte(new Date(c.data_fim + 'T00:00:00')) : null
    const vencendo = diasFim != null && diasFim <= 30
    return { c, meses, elegivel, diasFim, vencendo }
  }).sort((a, b) => {
    // prioridade: vencendo/elegível primeiro
    const pa = (a.vencendo ? 0 : 1) + (a.elegivel ? 0 : 1)
    const pb = (b.vencendo ? 0 : 1) + (b.elegivel ? 0 : 1)
    return pa - pb
  }), [contratos])

  const lista = filtro === 'elegiveis' ? linhas.filter(l => l.elegivel || l.vencendo) : linhas

  function abrir(l) {
    setErro('')
    setEditando({
      id: l.c.id, nome: l.c.inquilinos?.nome || 'Inquilino',
      valorAtual: Number(l.c.valor_aluguel || 0),
      indice: l.c.indice_reajuste || 'igpm', percentual: '',
      renovar: false, data_fim: l.c.data_fim || '', obs: ''
    })
  }

  const valorNovo = useMemo(() => {
    if (!editando) return 0
    const p = parseMoeda(editando.percentual)
    return Math.round(editando.valorAtual * (1 + p / 100) * 100) / 100
  }, [editando])

  async function aplicar(e) {
    e.preventDefault()
    const p = parseMoeda(editando.percentual)
    if (!p) { setErro('Informe o percentual do reajuste.'); return }
    setErro(''); setSalvando(true)
    try {
      const patch = {
        valor_aluguel: valorNovo,
        data_ultimo_reajuste: new Date().toISOString().slice(0, 10),
        indice_reajuste: editando.indice
      }
      if (editando.renovar && editando.data_fim) patch.data_fim = editando.data_fim
      const { error: e1 } = await supabase.from('contratos').update(patch).eq('id', editando.id)
      if (e1) throw e1
      const { error: e2 } = await supabase.from('contrato_reajustes').insert({
        org_id: org.id, contrato_id: editando.id, data: patch.data_ultimo_reajuste,
        indice: editando.indice, percentual: p,
        valor_anterior: editando.valorAtual, valor_novo: valorNovo,
        observacoes: editando.obs?.trim() || null
      })
      if (e2) throw e2
      setEditando(null)
      carregar()
    } catch (err) { setErro(err.message) } finally { setSalvando(false) }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Reajustes</h1>
          <p className="sub" style={{ margin: 0 }}>Contratos elegíveis a reajuste (12 meses) e os que estão vencendo. Aplique o índice e renove.</p>
        </div>
      </div>

      {contratos.length > 0 && (
        <div className="mt" style={{ display: 'flex', gap: 8 }}>
          <button className={filtro === 'elegiveis' ? 'ouro' : 'secundario'} onClick={() => setFiltro('elegiveis')}>Precisam de atenção</button>
          <button className={filtro === 'todos' ? 'ouro' : 'secundario'} onClick={() => setFiltro('todos')}>Todos vigentes</button>
        </div>
      )}

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="card mt">
          <strong>{contratos.length === 0 ? 'Nenhum contrato vigente' : 'Nada para reajustar agora ✅'}</strong>
          <p className="sub" style={{ marginBottom: 0 }}>
            {contratos.length === 0 ? 'Cadastre contratos para acompanhar reajustes.' : 'Nenhum contrato elegível a reajuste ou vencendo nos próximos 30 dias.'}
          </p>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 10 }}>
          {lista.map(l => {
            const cor = l.vencendo ? '#ef4444' : l.elegivel ? '#f97316' : '#334155'
            const q = l.c.quartos
            const local = q ? `${q.casas?.nome ? q.casas.nome + ' · ' : ''}${q.identificacao}` : '—'
            return (
              <div key={l.c.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderLeft: `4px solid ${cor}` }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{l.c.inquilinos?.nome || 'Inquilino'}</strong>
                    {l.elegivel && <span className="tag" style={tagCor('#f97316')}>Reajuste disponível</span>}
                    {l.vencendo && <span className="tag" style={tagCor('#ef4444')}>Vence {l.diasFim <= 0 ? 'vencido' : `em ${l.diasFim}d`}</span>}
                  </div>
                  <div className="sub" style={{ margin: '4px 0 0' }}>
                    {local} · {formatarMoeda(l.c.valor_aluguel)}/mês
                    {l.meses != null ? ` · último reajuste há ${l.meses} mês(es)` : ''}
                    {l.c.data_fim ? ` · fim ${formatarData(l.c.data_fim)}` : ''}
                  </div>
                </div>
                <button className="ouro" onClick={() => abrir(l)}>Reajustar</button>
              </div>
            )
          })}
        </div>
      )}

      {editando && (
        <Modal titulo={`Reajustar — ${editando.nome}`} onFechar={() => setEditando(null)}>
          <form onSubmit={aplicar}>
            <p className="sub" style={{ marginTop: 0 }}>Valor atual: <b>{formatarMoeda(editando.valorAtual)}</b>/mês</p>

            <div className="linha">
              <div>
                <label>Índice</label>
                <select value={editando.indice} onChange={e => setEditando({ ...editando, indice: e.target.value })}>
                  {Object.entries(INDICES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label>Percentual (%)</label>
                <input inputMode="decimal" autoFocus value={editando.percentual}
                       onChange={e => setEditando({ ...editando, percentual: e.target.value })} placeholder="ex.: 4,5" />
              </div>
            </div>

            <div className="card mt" style={{ padding: '12px 14px', background: 'var(--surface-2)' }}>
              <div className="sub" style={{ fontSize: '.78rem' }}>Novo valor do aluguel</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--cor-ouro)' }}>{formatarMoeda(valorNovo)}</div>
              <div className="sub" style={{ fontSize: '.72rem' }}>
                {valorNovo > editando.valorAtual ? `+ ${formatarMoeda(valorNovo - editando.valorAtual)}/mês` : 'sem aumento'}
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={editando.renovar}
                     onChange={e => setEditando({ ...editando, renovar: e.target.checked })} />
              Renovar o contrato (nova data de fim)
            </label>
            {editando.renovar && (
              <input type="date" value={editando.data_fim}
                     onChange={e => setEditando({ ...editando, data_fim: e.target.value })} />
            )}

            <label>Observações</label>
            <textarea rows={2} value={editando.obs}
                      onChange={e => setEditando({ ...editando, obs: e.target.value })} />

            {erro && <div className="erro">{erro}</div>}

            <div className="linha mt">
              <button type="button" className="secundario" onClick={() => setEditando(null)}>Cancelar</button>
              <button type="submit" className="ouro" disabled={salvando}>{salvando ? 'Aplicando…' : 'Aplicar reajuste'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

const tagCor = (c) => ({ background: c + '22', color: c, border: `1px solid ${c}55` })
