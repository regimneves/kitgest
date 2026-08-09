import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, parseMoeda } from '../lib/format'
import Modal from '../components/Modal'

const STATUS = {
  vago:       { label: 'Vago',        cor: '#22c55e' },
  ocupado:    { label: 'Ocupado',     cor: '#3b82f6' },
  reservado:  { label: 'Reservado',   cor: '#eab308' },
  manutencao: { label: 'Manutenção',  cor: '#f97316' }
}

const vazio = {
  identificacao: '', aluguel_base: '', valor_final: '', area_m2: '',
  capacidade: 1, encargos_inclusos: true, status: 'vago', observacoes: ''
}

export default function Quartos() {
  const { casaId } = useParams()
  const { org } = useOrg()
  const [casa, setCasa] = useState(null)
  const [quartos, setQuartos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [{ data: c }, { data: qs, error }] = await Promise.all([
      supabase.from('casas').select('*').eq('id', casaId).maybeSingle(),
      supabase.from('quartos').select('*').eq('casa_id', casaId).order('identificacao')
    ])
    if (error) setErro(error.message)
    setCasa(c || null)
    setQuartos(qs || [])
    setCarregando(false)
  }, [casaId])

  useEffect(() => { carregar() }, [carregar])

  function abrirNovo() { setErro(''); setEditando({ ...vazio }) }
  function abrirEdicao(q) {
    setErro('')
    setEditando({
      ...q,
      aluguel_base: q.aluguel_base ?? '',
      valor_final: q.valor_final ?? '',
      area_m2: q.area_m2 ?? '',
      capacidade: q.capacidade ?? 1
    })
  }

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    const base = parseMoeda(editando.aluguel_base)
    // valor_final padrão = base (o rateio das despesas soma aqui na fase futura)
    const final = editando.valor_final === '' ? base : parseMoeda(editando.valor_final)
    const payload = {
      org_id: org.id,
      casa_id: casaId,
      identificacao: editando.identificacao.trim(),
      aluguel_base: base,
      valor_final: final,
      area_m2: editando.area_m2 === '' ? null : parseMoeda(editando.area_m2),
      capacidade: editando.capacidade === '' ? 1 : Number(editando.capacidade),
      encargos_inclusos: editando.encargos_inclusos,
      status: editando.status,
      observacoes: editando.observacoes?.trim() || null
    }
    if (!payload.identificacao) { setErro('Informe a identificação do quarto.'); return }

    const q = editando.id
      ? supabase.from('quartos').update(payload).eq('id', editando.id)
      : supabase.from('quartos').insert(payload)
    const { error } = await q
    if (error) { setErro(error.message); return }
    setEditando(null)
    carregar()
  }

  async function excluir(q) {
    if (!window.confirm(`Excluir o quarto "${q.identificacao}"?`)) return
    const { error } = await supabase.from('quartos').delete().eq('id', q.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  const totalFinal = quartos.reduce((s, q) => s + Number(q.valor_final || 0), 0)

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <Link to="/casas" className="sub" style={{ textDecoration: 'none' }}>← Casas</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
        <div style={{ flex: 1 }}>
          <h1>Quartos {casa ? `· ${casa.nome}` : ''}</h1>
          <p className="sub" style={{ margin: 0 }}>
            {quartos.length} quarto(s) · potencial {formatarMoeda(totalFinal)}/mês
          </p>
        </div>
        <button className="ouro" onClick={abrirNovo}>+ Novo quarto</button>
      </div>

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : quartos.length === 0 ? (
        <div className="card mt">
          <strong>Nenhum quarto nesta casa</strong>
          <p className="sub">Cadastre os quartos para controlar ocupação e recebimentos.</p>
          <button className="ouro" onClick={abrirNovo}>+ Novo quarto</button>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 10 }}>
          {quartos.map(q => {
            const s = STATUS[q.status] || STATUS.vago
            return (
              <div key={q.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>{q.identificacao}</strong>
                    <span className="tag" style={{ background: s.cor + '22', color: s.cor, border: `1px solid ${s.cor}55` }}>
                      {s.label}
                    </span>
                  </div>
                  <div className="sub" style={{ margin: '4px 0 0' }}>
                    {formatarMoeda(q.valor_final)}/mês
                    {Number(q.aluguel_base) !== Number(q.valor_final) && <> · base {formatarMoeda(q.aluguel_base)}</>}
                    {q.capacidade ? ` · ${q.capacidade} morador(es)` : ''}
                    {q.area_m2 ? ` · ${q.area_m2} m²` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="secundario" onClick={() => abrirEdicao(q)}>Editar</button>
                  <button className="secundario" onClick={() => excluir(q)} title="Excluir">🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editando && (
        <Modal titulo={editando.id ? 'Editar quarto' : 'Novo quarto'} onFechar={() => setEditando(null)}>
          <form onSubmit={salvar}>
            <label>Identificação *</label>
            <input value={editando.identificacao} autoFocus
                   onChange={e => setEditando({ ...editando, identificacao: e.target.value })}
                   placeholder="Ex.: Quarto 1 / Suíte / 101" />

            <div className="linha">
              <div>
                <label>Aluguel base (R$/mês)</label>
                <input inputMode="decimal" value={editando.aluguel_base}
                       onChange={e => setEditando({ ...editando, aluguel_base: e.target.value })}
                       placeholder="0,00" />
              </div>
              <div>
                <label>Valor final (cobrado)</label>
                <input inputMode="decimal" value={editando.valor_final}
                       onChange={e => setEditando({ ...editando, valor_final: e.target.value })}
                       placeholder="= base, se vazio" />
              </div>
            </div>
            <p className="sub" style={{ marginTop: 6 }}>
              O valor final é o cobrado do inquilino. Se deixar vazio, copia o aluguel base. A tela <b>Composição</b> da casa recalcula este valor somando o rateio das despesas.
            </p>

            <div className="linha">
              <div>
                <label>Área (m²)</label>
                <input inputMode="decimal" value={editando.area_m2}
                       onChange={e => setEditando({ ...editando, area_m2: e.target.value })}
                       placeholder="opcional" />
              </div>
              <div>
                <label>Capacidade (moradores)</label>
                <input inputMode="numeric" value={editando.capacidade}
                       onChange={e => setEditando({ ...editando, capacidade: e.target.value })} />
              </div>
            </div>

            <label>Status</label>
            <select value={editando.status}
                    onChange={e => setEditando({ ...editando, status: e.target.value })}>
              {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
            </select>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={editando.encargos_inclusos}
                     onChange={e => setEditando({ ...editando, encargos_inclusos: e.target.checked })} />
              Água/luz e encargos inclusos no aluguel
            </label>

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
    </div>
  )
}
