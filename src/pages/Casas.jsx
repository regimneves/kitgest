import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, parseMoeda } from '../lib/format'
import Modal from '../components/Modal'

const CRITERIOS = {
  igual: 'Igual entre os quartos',
  area_m2: 'Por área (m²)',
  moradores: 'Por nº de moradores'
}

const vazia = {
  nome: '', endereco: '', tipo: 'sublocada', aluguel_mae: '',
  criterio_rateio: 'igual', qtd_quartos_ref: '', observacoes: '', ativo: true
}

export default function Casas() {
  const { org } = useOrg()
  const navigate = useNavigate()
  const [casas, setCasas] = useState([])
  const [contagem, setContagem] = useState({})   // casa_id -> nº de quartos
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(null) // objeto do form ou null
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data: cs, error } = await supabase
      .from('casas').select('*').order('nome')
    if (error) setErro(error.message)
    setCasas(cs || [])

    // contagem de quartos por casa
    const { data: qs } = await supabase.from('quartos').select('casa_id')
    const cont = {}
    for (const q of qs || []) cont[q.casa_id] = (cont[q.casa_id] || 0) + 1
    setContagem(cont)
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function abrirNova() { setErro(''); setEditando({ ...vazia }) }
  function abrirEdicao(c) {
    setErro('')
    setEditando({
      ...c,
      aluguel_mae: c.aluguel_mae ?? '',
      qtd_quartos_ref: c.qtd_quartos_ref ?? ''
    })
  }

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    const payload = {
      org_id: org.id,
      nome: editando.nome.trim(),
      endereco: editando.endereco?.trim() || null,
      tipo: editando.tipo,
      aluguel_mae: parseMoeda(editando.aluguel_mae),
      criterio_rateio: editando.criterio_rateio,
      qtd_quartos_ref: editando.qtd_quartos_ref === '' ? null : Number(editando.qtd_quartos_ref),
      observacoes: editando.observacoes?.trim() || null,
      ativo: editando.ativo
    }
    if (!payload.nome) { setErro('Informe o nome da casa.'); return }

    const q = editando.id
      ? supabase.from('casas').update(payload).eq('id', editando.id)
      : supabase.from('casas').insert(payload)
    const { error } = await q
    if (error) { setErro(error.message); return }
    setEditando(null)
    carregar()
  }

  async function excluir(c) {
    const n = contagem[c.id] || 0
    const aviso = n > 0
      ? `Excluir "${c.nome}"? Isso apaga também os ${n} quarto(s) e os dados ligados a eles.`
      : `Excluir "${c.nome}"?`
    if (!window.confirm(aviso)) return
    const { error } = await supabase.from('casas').delete().eq('id', c.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Casas</h1>
          <p className="sub" style={{ margin: 0 }}>Imóveis sublocados e o critério de rateio das despesas.</p>
        </div>
        <button className="ouro" onClick={abrirNova}>+ Nova casa</button>
      </div>

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : casas.length === 0 ? (
        <div className="card mt">
          <strong>Nenhuma casa ainda</strong>
          <p className="sub">Cadastre a primeira casa para começar a organizar os quartos.</p>
          <button className="ouro" onClick={abrirNova}>+ Nova casa</button>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 12 }}>
          {casas.map(c => (
            <div key={c.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong>{c.nome}</strong>
                  {!c.ativo && <span className="tag" style={{ background: 'var(--surface-2)' }}>inativa</span>}
                </div>
                <div className="sub" style={{ margin: '4px 0 0' }}>
                  {c.endereco || 'sem endereço'} · {contagem[c.id] || 0} quarto(s) · rateio {CRITERIOS[c.criterio_rateio]?.toLowerCase()}
                </div>
                {Number(c.aluguel_mae) > 0 && (
                  <div className="sub" style={{ margin: '2px 0 0' }}>aluguel-mãe {formatarMoeda(c.aluguel_mae)}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="ouro" onClick={() => navigate(`/casas/${c.id}/quartos`)}>Quartos</button>
                <button className="secundario" onClick={() => navigate(`/casas/${c.id}/composicao`)}>Composição</button>
                <button className="secundario" onClick={() => abrirEdicao(c)}>Editar</button>
                <button className="secundario" onClick={() => excluir(c)} title="Excluir">🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editando && (
        <Modal titulo={editando.id ? 'Editar casa' : 'Nova casa'} onFechar={() => setEditando(null)}>
          <form onSubmit={salvar}>
            <label>Nome *</label>
            <input value={editando.nome} autoFocus
                   onChange={e => setEditando({ ...editando, nome: e.target.value })}
                   placeholder="Ex.: Casa Amarela / Rua X, 123" />

            <label>Endereço</label>
            <input value={editando.endereco || ''}
                   onChange={e => setEditando({ ...editando, endereco: e.target.value })} />

            <div className="linha">
              <div>
                <label>Aluguel-mãe (R$/mês)</label>
                <input inputMode="decimal" value={editando.aluguel_mae}
                       onChange={e => setEditando({ ...editando, aluguel_mae: e.target.value })}
                       placeholder="0,00" />
              </div>
              <div>
                <label>Nº de quartos (ref.)</label>
                <input inputMode="numeric" value={editando.qtd_quartos_ref}
                       onChange={e => setEditando({ ...editando, qtd_quartos_ref: e.target.value })}
                       placeholder="ex.: 10" />
              </div>
            </div>

            <label>Critério de rateio das despesas</label>
            <select value={editando.criterio_rateio}
                    onChange={e => setEditando({ ...editando, criterio_rateio: e.target.value })}>
              {Object.entries(CRITERIOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>

            <label>Observações</label>
            <textarea rows={2} value={editando.observacoes || ''}
                      onChange={e => setEditando({ ...editando, observacoes: e.target.value })} />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={editando.ativo}
                     onChange={e => setEditando({ ...editando, ativo: e.target.checked })} />
              Casa ativa
            </label>

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
