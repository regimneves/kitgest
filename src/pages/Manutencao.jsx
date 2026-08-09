import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, parseMoeda, formatarData } from '../lib/format'
import { comprimirImagem } from '../lib/imagem'
import Modal from '../components/Modal'

const PRIORIDADE = {
  baixa: { label: 'Baixa', cor: '#94a3b8' },
  media: { label: 'Média', cor: '#eab308' },
  alta:  { label: 'Alta',  cor: '#ef4444' }
}
const STATUS = {
  aberta:       { label: 'Aberta',       cor: '#3b82f6' },
  em_andamento: { label: 'Em andamento', cor: '#f97316' },
  concluida:    { label: 'Concluída',    cor: '#22c55e' }
}
const PROXIMO = { aberta: 'em_andamento', em_andamento: 'concluida', concluida: 'aberta' }

const vazio = () => ({
  id: null, casa_id: '', quarto_id: '', titulo: '', descricao: '',
  prioridade: 'media', status: 'aberta', responsavel: '', custo: '', fotos: []
})

export default function Manutencao() {
  const { org } = useOrg()
  const [ordens, setOrdens] = useState([])
  const [casas, setCasas] = useState([])
  const [quartos, setQuartos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [filtro, setFiltro] = useState('abertas') // abertas | todas
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [{ data: os, error }, { data: cs }, { data: qs }] = await Promise.all([
      supabase.from('manutencao')
        .select('*, casas(nome), quartos(identificacao)')
        .order('aberto_em', { ascending: false }),
      supabase.from('casas').select('id, nome').order('nome'),
      supabase.from('quartos').select('id, identificacao, casa_id').order('identificacao')
    ])
    if (error) setErro(error.message)
    setOrdens(os || [])
    setCasas(cs || [])
    setQuartos(qs || [])
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function abrirNovo() { setErro(''); setEditando(vazio()) }
  async function abrirEdicao(o) {
    setErro('')
    const paths = Array.isArray(o.fotos) ? o.fotos : []
    const fotos = []
    for (const p of paths) {
      const { data } = await supabase.storage.from('vistoria-fotos').createSignedUrl(p, 3600)
      fotos.push({ path: p, src: data?.signedUrl || null })
    }
    setEditando({
      id: o.id, casa_id: o.casa_id || '', quarto_id: o.quarto_id || '',
      titulo: o.titulo, descricao: o.descricao || '', prioridade: o.prioridade,
      status: o.status, responsavel: o.responsavel || '', custo: o.custo ?? '', fotos
    })
  }

  const quartosDaCasa = useMemo(() => {
    if (!editando?.casa_id) return []
    return quartos.filter(q => q.casa_id === editando.casa_id)
  }, [editando, quartos])

  async function adicionarFoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErro('')
    try {
      const { blob, previa } = await comprimirImagem(file)
      const path = `${org.id}/${crypto.randomUUID()}.jpg`
      const { error } = await supabase.storage.from('vistoria-fotos').upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      setEditando(ed => ({ ...ed, fotos: [...ed.fotos, { path, src: previa }] }))
    } catch (err) { setErro('Falha na foto: ' + err.message) }
  }
  function removerFoto(idx) {
    const foto = editando.fotos[idx]
    if (foto?.path) supabase.storage.from('vistoria-fotos').remove([foto.path])
    setEditando(ed => ({ ...ed, fotos: ed.fotos.filter((_, i) => i !== idx) }))
  }

  async function salvar(e) {
    e.preventDefault()
    if (!editando.titulo.trim()) { setErro('Informe o título da ordem.'); return }
    setErro(''); setSalvando(true)
    try {
      const payload = {
        org_id: org.id,
        casa_id: editando.casa_id || null,
        quarto_id: editando.quarto_id || null,
        titulo: editando.titulo.trim(),
        descricao: editando.descricao?.trim() || null,
        prioridade: editando.prioridade,
        status: editando.status,
        responsavel: editando.responsavel?.trim() || null,
        custo: parseMoeda(editando.custo),
        fotos: editando.fotos.map(f => f.path),
        concluido_em: editando.status === 'concluida' ? new Date().toISOString() : null
      }
      const q = editando.id
        ? supabase.from('manutencao').update(payload).eq('id', editando.id)
        : supabase.from('manutencao').insert(payload)
      const { error } = await q
      if (error) throw error
      setEditando(null)
      carregar()
    } catch (err) { setErro(err.message) } finally { setSalvando(false) }
  }

  // Avança o status no toque (aberta → andamento → concluída → aberta)
  async function avancar(o) {
    const novo = PROXIMO[o.status]
    const patch = { status: novo, concluido_em: novo === 'concluida' ? new Date().toISOString() : null }
    const { error } = await supabase.from('manutencao').update(patch).eq('id', o.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  async function excluir(o) {
    if (!window.confirm(`Excluir a ordem "${o.titulo}"?`)) return
    if (Array.isArray(o.fotos) && o.fotos.length) supabase.storage.from('vistoria-fotos').remove(o.fotos)
    const { error } = await supabase.from('manutencao').delete().eq('id', o.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  const lista = filtro === 'abertas' ? ordens.filter(o => o.status !== 'concluida') : ordens
  const abertas = ordens.filter(o => o.status !== 'concluida').length

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Manutenção</h1>
          <p className="sub" style={{ margin: 0 }}>Ordens de reparo — {abertas} aberta(s).</p>
        </div>
        <button className="ouro" onClick={abrirNovo}>+ Nova ordem</button>
      </div>

      {ordens.length > 0 && (
        <div className="mt" style={{ display: 'flex', gap: 8 }}>
          <button className={filtro === 'abertas' ? 'ouro' : 'secundario'} onClick={() => setFiltro('abertas')}>Abertas</button>
          <button className={filtro === 'todas' ? 'ouro' : 'secundario'} onClick={() => setFiltro('todas')}>Todas</button>
        </div>
      )}

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : ordens.length === 0 ? (
        <div className="card mt">
          <strong>Nenhuma ordem ainda</strong>
          <p className="sub">Abra uma ordem quando algo precisar de reparo (vazamento, elétrica, pintura…).</p>
          <button className="ouro" onClick={abrirNovo}>+ Nova ordem</button>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 10 }}>
          {lista.map(o => {
            const p = PRIORIDADE[o.prioridade] || PRIORIDADE.media
            const s = STATUS[o.status] || STATUS.aberta
            const onde = [o.casas?.nome, o.quartos?.identificacao].filter(Boolean).join(' · ') || 'geral'
            return (
              <div key={o.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderLeft: `4px solid ${p.cor}` }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{o.titulo}</strong>
                    <span className="tag" style={{ background: s.cor + '22', color: s.cor, border: `1px solid ${s.cor}55` }}>{s.label}</span>
                    <span className="tag" style={{ background: p.cor + '22', color: p.cor, border: `1px solid ${p.cor}55` }}>{p.label}</span>
                  </div>
                  <div className="sub" style={{ margin: '4px 0 0' }}>
                    {onde}
                    {Number(o.custo) > 0 ? ` · ${formatarMoeda(o.custo)}` : ''}
                    {o.responsavel ? ` · ${o.responsavel}` : ''}
                    {` · aberta ${formatarData(new Date(o.aberto_em).toISOString())}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {o.status !== 'concluida' && (
                    <button className="ouro" onClick={() => avancar(o)}>
                      {o.status === 'aberta' ? 'Iniciar' : 'Concluir'}
                    </button>
                  )}
                  <button className="secundario" onClick={() => abrirEdicao(o)}>Editar</button>
                  <button className="secundario" onClick={() => excluir(o)} title="Excluir">🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editando && (
        <Modal titulo={editando.id ? 'Editar ordem' : 'Nova ordem'} onFechar={() => setEditando(null)}>
          <form onSubmit={salvar}>
            <label>Título *</label>
            <input value={editando.titulo} autoFocus
                   onChange={e => setEditando({ ...editando, titulo: e.target.value })}
                   placeholder="Ex.: Vazamento na pia do banheiro" />

            <div className="linha">
              <div>
                <label>Casa</label>
                <select value={editando.casa_id}
                        onChange={e => setEditando({ ...editando, casa_id: e.target.value, quarto_id: '' })}>
                  <option value="">— geral —</option>
                  {casas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div>
                <label>Quarto</label>
                <select value={editando.quarto_id} disabled={!editando.casa_id}
                        onChange={e => setEditando({ ...editando, quarto_id: e.target.value })}>
                  <option value="">— todo o imóvel —</option>
                  {quartosDaCasa.map(q => <option key={q.id} value={q.id}>{q.identificacao}</option>)}
                </select>
              </div>
            </div>

            <div className="linha">
              <div>
                <label>Prioridade</label>
                <select value={editando.prioridade} onChange={e => setEditando({ ...editando, prioridade: e.target.value })}>
                  {Object.entries(PRIORIDADE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label>Status</label>
                <select value={editando.status} onChange={e => setEditando({ ...editando, status: e.target.value })}>
                  {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <div className="linha">
              <div>
                <label>Responsável</label>
                <input value={editando.responsavel}
                       onChange={e => setEditando({ ...editando, responsavel: e.target.value })}
                       placeholder="quem vai executar" />
              </div>
              <div>
                <label>Custo (R$)</label>
                <input inputMode="decimal" value={editando.custo}
                       onChange={e => setEditando({ ...editando, custo: e.target.value })}
                       placeholder="0,00" />
              </div>
            </div>

            <label>Descrição</label>
            <textarea rows={2} value={editando.descricao}
                      onChange={e => setEditando({ ...editando, descricao: e.target.value })} />

            <label style={{ marginTop: 8 }}>Fotos</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {editando.fotos.map((f, idx) => (
                <div key={idx} style={{ position: 'relative' }}>
                  <img src={f.src} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--borda)' }} />
                  <button type="button" onClick={() => removerFoto(idx)} title="Remover foto"
                          style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
                </div>
              ))}
              <label className="secundario" style={{ cursor: 'pointer', padding: '8px 12px', borderRadius: 8, fontSize: '.9rem' }}>
                📷 Foto
                <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={adicionarFoto} />
              </label>
            </div>

            {erro && <div className="erro">{erro}</div>}

            <div className="linha mt">
              <button type="button" className="secundario" onClick={() => setEditando(null)}>Cancelar</button>
              <button type="submit" className="ouro" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
