import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import Modal from '../components/Modal'

const vazio = {
  nome: '', cpf: '', telefone: '', email: '',
  contato_emergencia: '', observacoes: ''
}

// Só dígitos → link wa.me (assume Brasil se vier sem DDI).
function linkWhatsApp(telefone) {
  const d = String(telefone || '').replace(/\D/g, '')
  if (d.length < 10) return null
  const comDdi = d.startsWith('55') ? d : `55${d}`
  return `https://wa.me/${comDdi}`
}

export default function Inquilinos() {
  const { org } = useOrg()
  const [inquilinos, setInquilinos] = useState([])
  const [contratosPorInq, setContratosPorInq] = useState({}) // inquilino_id -> nº contratos ativos
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data: is, error } = await supabase
      .from('inquilinos').select('*').order('nome')
    if (error) setErro(error.message)
    setInquilinos(is || [])

    // quantos contratos ativos cada inquilino tem (p/ aviso de exclusão)
    const { data: cs } = await supabase
      .from('contratos').select('inquilino_id, status')
    const cont = {}
    for (const c of cs || []) {
      if (c.status === 'ativo' || c.status === 'inadimplente')
        cont[c.inquilino_id] = (cont[c.inquilino_id] || 0) + 1
    }
    setContratosPorInq(cont)
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function abrirNovo() { setErro(''); setEditando({ ...vazio }) }
  function abrirEdicao(i) { setErro(''); setEditando({ ...i }) }

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    const payload = {
      org_id: org.id,
      nome: editando.nome.trim(),
      cpf: editando.cpf?.trim() || null,
      telefone: editando.telefone?.trim() || null,
      email: editando.email?.trim() || null,
      contato_emergencia: editando.contato_emergencia?.trim() || null,
      observacoes: editando.observacoes?.trim() || null
    }
    if (!payload.nome) { setErro('Informe o nome do inquilino.'); return }

    const q = editando.id
      ? supabase.from('inquilinos').update(payload).eq('id', editando.id)
      : supabase.from('inquilinos').insert(payload)
    const { error } = await q
    if (error) { setErro(error.message); return }
    setEditando(null)
    carregar()
  }

  async function excluir(i) {
    const n = contratosPorInq[i.id] || 0
    if (n > 0) {
      window.alert(`"${i.nome}" tem ${n} contrato(s) ativo(s). Encerre o(s) contrato(s) antes de excluir.`)
      return
    }
    if (!window.confirm(`Excluir "${i.nome}"?`)) return
    const { error } = await supabase.from('inquilinos').delete().eq('id', i.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  const termo = busca.trim().toLowerCase()
  const lista = termo
    ? inquilinos.filter(i =>
        (i.nome || '').toLowerCase().includes(termo) ||
        (i.cpf || '').toLowerCase().includes(termo) ||
        (i.telefone || '').toLowerCase().includes(termo))
    : inquilinos

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Inquilinos</h1>
          <p className="sub" style={{ margin: 0 }}>Cadastro das pessoas que alugam os quartos.</p>
        </div>
        <button className="ouro" onClick={abrirNovo}>+ Novo inquilino</button>
      </div>

      {inquilinos.length > 0 && (
        <input className="mt" placeholder="Buscar por nome, CPF ou telefone…"
               value={busca} onChange={e => setBusca(e.target.value)} />
      )}

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : inquilinos.length === 0 ? (
        <div className="card mt">
          <strong>Nenhum inquilino ainda</strong>
          <p className="sub">Cadastre os inquilinos para depois vincular a um quarto por contrato.</p>
          <button className="ouro" onClick={abrirNovo}>+ Novo inquilino</button>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 10 }}>
          {lista.map(i => {
            const wa = linkWhatsApp(i.telefone)
            const ativos = contratosPorInq[i.id] || 0
            return (
              <div key={i.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>{i.nome}</strong>
                    {ativos > 0 && <span className="tag" style={{ background: '#3b82f622', color: '#3b82f6', border: '1px solid #3b82f655' }}>
                      {ativos} contrato(s)
                    </span>}
                  </div>
                  <div className="sub" style={{ margin: '4px 0 0' }}>
                    {i.telefone || 'sem telefone'}
                    {i.cpf ? ` · CPF ${i.cpf}` : ''}
                    {i.email ? ` · ${i.email}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {wa && <a href={wa} target="_blank" rel="noopener noreferrer">
                    <button className="secundario" title="Abrir no WhatsApp">💬</button>
                  </a>}
                  <button className="secundario" onClick={() => abrirEdicao(i)}>Editar</button>
                  <button className="secundario" onClick={() => excluir(i)} title="Excluir">🗑</button>
                </div>
              </div>
            )
          })}
          {lista.length === 0 && <p className="sub">Nenhum inquilino encontrado para “{busca}”.</p>}
        </div>
      )}

      {editando && (
        <Modal titulo={editando.id ? 'Editar inquilino' : 'Novo inquilino'} onFechar={() => setEditando(null)}>
          <form onSubmit={salvar}>
            <label>Nome *</label>
            <input value={editando.nome} autoFocus
                   onChange={e => setEditando({ ...editando, nome: e.target.value })}
                   placeholder="Nome completo" />

            <div className="linha">
              <div>
                <label>CPF</label>
                <input value={editando.cpf || ''}
                       onChange={e => setEditando({ ...editando, cpf: e.target.value })}
                       placeholder="opcional" />
              </div>
              <div>
                <label>Telefone / WhatsApp</label>
                <input inputMode="tel" value={editando.telefone || ''}
                       onChange={e => setEditando({ ...editando, telefone: e.target.value })}
                       placeholder="(11) 90000-0000" />
              </div>
            </div>

            <label>E-mail</label>
            <input inputMode="email" value={editando.email || ''}
                   onChange={e => setEditando({ ...editando, email: e.target.value })}
                   placeholder="opcional" />

            <label>Contato de emergência</label>
            <input value={editando.contato_emergencia || ''}
                   onChange={e => setEditando({ ...editando, contato_emergencia: e.target.value })}
                   placeholder="nome e telefone de um parente/amigo" />

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
