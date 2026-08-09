import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, parseMoeda, formatarData } from '../lib/format'
import { gerarAcertoPDF } from '../lib/recibo'
import Modal from '../components/Modal'

const TIPOS = { dano: 'Dano', pendencia: 'Pendência', limpeza: 'Limpeza', chave: 'Chave', outro: 'Outro' }
const hoje = () => new Date().toISOString().slice(0, 10)
const novaLinha = () => ({ _key: crypto.randomUUID(), tipo: 'dano', descricao: '', valor: '' })

export default function Acertos() {
  const { org } = useOrg()
  const [acertos, setAcertos] = useState([])
  const [contratos, setContratos] = useState([])
  const [vistoriasSaida, setVistoriasSaida] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [{ data: as, error }, { data: cs }, { data: vs }] = await Promise.all([
      supabase.from('acertos_saida')
        .select('*, contratos(caucao_valor, inquilinos(nome, cpf), quartos(identificacao, casas(nome)))')
        .order('criado_em', { ascending: false }),
      supabase.from('contratos')
        .select('id, status, caucao_valor, quarto_id, inquilino_id, inquilinos(nome, cpf), quartos(identificacao, casas(nome))')
        .order('criado_em', { ascending: false }),
      supabase.from('vistorias')
        .select('id, quarto_id, realizada_em').eq('tipo', 'saida')
    ])
    if (error) setErro(error.message)
    setAcertos(as || [])
    setContratos(cs || [])
    setVistoriasSaida(vs || [])
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function abrirNovo() {
    setErro('')
    setEditando({
      id: null, contrato_id: '', vistoria_saida_id: '', caucao_valor: '',
      realizado_em: hoje(), observacoes: '', encerrar: true,
      itens: [novaLinha()]
    })
  }

  async function abrirEdicao(a) {
    setErro('')
    const { data: its } = await supabase.from('acerto_itens')
      .select('*').eq('acerto_id', a.id).order('criado_em')
    setEditando({
      id: a.id, contrato_id: a.contrato_id, vistoria_saida_id: a.vistoria_saida_id || '',
      caucao_valor: a.caucao_valor ?? '', realizado_em: a.realizado_em ? String(a.realizado_em).slice(0, 10) : hoje(),
      observacoes: a.observacoes || '', encerrar: false,
      itens: (its || []).map(i => ({ _key: crypto.randomUUID(), tipo: i.tipo, descricao: i.descricao || '', valor: i.valor ?? '' }))
    })
  }

  function escolherContrato(contrato_id) {
    const c = contratos.find(x => x.id === contrato_id)
    setEditando(ed => ({
      ...ed,
      contrato_id,
      caucao_valor: (ed.caucao_valor === '' || ed.caucao_valor == null) && c ? c.caucao_valor : ed.caucao_valor
    }))
  }

  const contratoSel = editando && contratos.find(c => c.id === editando.contrato_id)
  const vistoriasDoQuarto = useMemo(() => {
    if (!contratoSel) return []
    return vistoriasSaida.filter(v => v.quarto_id === contratoSel.quarto_id)
  }, [contratoSel, vistoriasSaida])

  const totalDescontos = useMemo(() => {
    if (!editando) return 0
    return editando.itens.reduce((s, i) => s + parseMoeda(i.valor), 0)
  }, [editando])
  const caucao = editando ? parseMoeda(editando.caucao_valor) : 0
  const aDevolver = caucao - totalDescontos

  function setLinha(key, patch) {
    setEditando(ed => ({ ...ed, itens: ed.itens.map(i => i._key === key ? { ...i, ...patch } : i) }))
  }
  function addLinha() { setEditando(ed => ({ ...ed, itens: [...ed.itens, novaLinha()] })) }
  function delLinha(key) { setEditando(ed => ({ ...ed, itens: ed.itens.filter(i => i._key !== key) })) }

  async function proximoRecibo() {
    const { data, error } = await supabase.rpc('proximo_recibo', { p_org: org.id })
    if (error) throw error
    return data
  }

  async function salvar(e) {
    e.preventDefault()
    if (!editando.contrato_id) { setErro('Escolha o contrato.'); return }
    setErro(''); setSalvando(true)
    try {
      const cab = {
        org_id: org.id,
        contrato_id: editando.contrato_id,
        vistoria_saida_id: editando.vistoria_saida_id || null,
        caucao_valor: caucao,
        total_descontos: totalDescontos,
        valor_a_devolver: aDevolver,
        realizado_em: editando.realizado_em ? new Date(editando.realizado_em).toISOString() : new Date().toISOString(),
        observacoes: editando.observacoes?.trim() || null
      }

      let aid = editando.id
      if (editando.id) {
        const { error } = await supabase.from('acertos_saida').update(cab).eq('id', editando.id)
        if (error) throw error
        await supabase.from('acerto_itens').delete().eq('acerto_id', editando.id)
      } else {
        cab.recibo_numero = await proximoRecibo()
        const { data, error } = await supabase.from('acertos_saida').insert(cab).select('id').single()
        if (error) throw error
        aid = data.id
      }

      const linhas = editando.itens
        .filter(i => parseMoeda(i.valor) !== 0 || i.descricao.trim())
        .map(i => ({ org_id: org.id, acerto_id: aid, tipo: i.tipo, descricao: i.descricao?.trim() || null, valor: parseMoeda(i.valor) }))
      if (linhas.length) {
        const { error } = await supabase.from('acerto_itens').insert(linhas)
        if (error) throw error
      }

      // Encerrar contrato + liberar quarto (só ao criar, se marcado)
      if (editando.encerrar && contratoSel) {
        await supabase.from('contratos').update({ status: 'encerrado' }).eq('id', editando.contrato_id)
        await supabase.from('quartos').update({ status: 'vago' }).eq('id', contratoSel.quarto_id)
      }

      setEditando(null)
      carregar()
    } catch (err) {
      setErro(err.message)
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(a) {
    if (!window.confirm('Excluir este acerto e seus itens?')) return
    const { error } = await supabase.from('acertos_saida').delete().eq('id', a.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  async function baixarRecibo(a) {
    setErro('')
    try {
      const { data: its } = await supabase.from('acerto_itens').select('*').eq('acerto_id', a.id).order('criado_em')
      await gerarAcertoPDF({
        org, acerto: a,
        inquilino: a.contratos?.inquilinos || {},
        quarto: a.contratos?.quartos || {},
        casa: a.contratos?.quartos?.casas || null,
        itens: its || []
      })
    } catch (err) { setErro(err.message) }
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Acerto de saída</h1>
          <p className="sub" style={{ margin: 0 }}>Devolução da caução: caução − danos/pendências = a devolver.</p>
        </div>
        <button className="ouro" onClick={abrirNovo} disabled={contratos.length === 0}>+ Novo acerto</button>
      </div>

      {contratos.length === 0 && !carregando && (
        <div className="card mt" style={{ borderColor: 'var(--cor-ouro)' }}>
          <strong>Nenhum contrato</strong>
          <p className="sub" style={{ marginBottom: 0 }}>O acerto parte de um contrato. Crie um em <b>Contratos</b>.</p>
        </div>
      )}

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : acertos.length === 0 ? (
        <div className="card mt">
          <strong>Nenhum acerto ainda</strong>
          <p className="sub">Faça o acerto quando o inquilino devolver o quarto.</p>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 10 }}>
          {acertos.map(a => {
            const inq = a.contratos?.inquilinos?.nome || 'Inquilino'
            const q = a.contratos?.quartos
            const quartoTxt = q ? `${q.casas?.nome ? q.casas.nome + ' · ' : ''}${q.identificacao}` : '—'
            const dev = Number(a.valor_a_devolver || 0)
            const aCobrar = dev < 0
            return (
              <div key={a.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{inq}</strong>
                    {a.recibo_numero != null && <span className="tag" style={{ background: 'var(--surface-2)' }}>acerto {String(a.recibo_numero).padStart(4, '0')}</span>}
                    <span className="tag" style={{
                      background: (aCobrar ? '#ef4444' : '#22c55e') + '22',
                      color: aCobrar ? '#ef4444' : '#22c55e',
                      border: `1px solid ${(aCobrar ? '#ef4444' : '#22c55e')}55`
                    }}>
                      {aCobrar ? 'a cobrar' : 'a devolver'} {formatarMoeda(Math.abs(dev))}
                    </span>
                  </div>
                  <div className="sub" style={{ margin: '4px 0 0' }}>
                    {quartoTxt} · caução {formatarMoeda(a.caucao_valor)} − descontos {formatarMoeda(a.total_descontos)}
                    {a.realizado_em ? ` · ${formatarData(new Date(a.realizado_em).toISOString())}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="secundario" onClick={() => baixarRecibo(a)}>Recibo</button>
                  <button className="secundario" onClick={() => abrirEdicao(a)}>Editar</button>
                  <button className="secundario" onClick={() => excluir(a)} title="Excluir">🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editando && (
        <Modal titulo={editando.id ? 'Editar acerto' : 'Novo acerto de saída'} onFechar={() => setEditando(null)}>
          <form onSubmit={salvar}>
            <label>Contrato *</label>
            <select value={editando.contrato_id} onChange={e => escolherContrato(e.target.value)} disabled={!!editando.id}>
              <option value="">— escolher —</option>
              {contratos.map(c => {
                const casa = c.quartos?.casas?.nome ? `${c.quartos.casas.nome} · ` : ''
                return <option key={c.id} value={c.id}>{c.inquilinos?.nome} — {casa}{c.quartos?.identificacao}</option>
              })}
            </select>

            <div className="linha">
              <div>
                <label>Caução recebida (R$)</label>
                <input inputMode="decimal" value={editando.caucao_valor}
                       onChange={e => setEditando({ ...editando, caucao_valor: e.target.value })}
                       placeholder="0,00" />
              </div>
              <div>
                <label>Data do acerto</label>
                <input type="date" value={editando.realizado_em}
                       onChange={e => setEditando({ ...editando, realizado_em: e.target.value })} />
              </div>
            </div>

            {vistoriasDoQuarto.length > 0 && (
              <>
                <label>Vistoria de saída (opcional)</label>
                <select value={editando.vistoria_saida_id}
                        onChange={e => setEditando({ ...editando, vistoria_saida_id: e.target.value })}>
                  <option value="">— nenhuma —</option>
                  {vistoriasDoQuarto.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.realizada_em ? formatarData(new Date(v.realizada_em).toISOString()) : 'sem data'}
                    </option>
                  ))}
                </select>
              </>
            )}

            <div style={{ display: 'flex', alignItems: 'center', marginTop: 16 }}>
              <strong style={{ flex: 1 }}>Descontos</strong>
              <button type="button" className="secundario" onClick={addLinha}>+ Linha</button>
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              {editando.itens.map(l => (
                <div key={l._key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select value={l.tipo} onChange={e => setLinha(l._key, { tipo: e.target.value })} style={{ flex: '0 0 32%' }}>
                    {Object.entries(TIPOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                  <input value={l.descricao} onChange={e => setLinha(l._key, { descricao: e.target.value })}
                         placeholder="descrição" style={{ flex: 1 }} />
                  <input inputMode="decimal" value={l.valor} onChange={e => setLinha(l._key, { valor: e.target.value })}
                         placeholder="0,00" style={{ flex: '0 0 22%' }} />
                  <button type="button" className="secundario" onClick={() => delLinha(l._key)} title="Remover"
                          style={{ padding: '8px 10px' }}>×</button>
                </div>
              ))}
            </div>

            {/* Resumo ao vivo */}
            <div className="card mt" style={{ background: 'var(--surface-2)' }}>
              <div className="linha" style={{ justifyContent: 'space-between' }}>
                <span className="sub">Caução</span><span>{formatarMoeda(caucao)}</span>
              </div>
              <div className="linha" style={{ justifyContent: 'space-between' }}>
                <span className="sub">Total descontos</span><span>− {formatarMoeda(totalDescontos)}</span>
              </div>
              <div className="linha" style={{ justifyContent: 'space-between', fontWeight: 700, marginTop: 4 }}>
                <span>{aDevolver < 0 ? 'A cobrar do inquilino' : 'A devolver'}</span>
                <span style={{ color: aDevolver < 0 ? '#ef4444' : '#22c55e' }}>{formatarMoeda(Math.abs(aDevolver))}</span>
              </div>
            </div>

            <label style={{ marginTop: 12 }}>Observações</label>
            <textarea rows={2} value={editando.observacoes}
                      onChange={e => setEditando({ ...editando, observacoes: e.target.value })} />

            {!editando.id && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={editando.encerrar}
                       onChange={e => setEditando({ ...editando, encerrar: e.target.checked })} />
                Encerrar o contrato e liberar o quarto
              </label>
            )}

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
