import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, parseMoeda, compararNatural } from '../lib/format'
import { vencimentoNaCompetencia, diasAte, mesAtual, competenciaISO } from '../lib/gestao'
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

const VIGENTE = new Set(['ativo', 'inadimplente', 'pendente'])

// Estado visual de cada quarto no painel.
const ESTADO = {
  atrasado:   { cor: '#ef4444', label: 'Atrasado' },
  ocupado:    { cor: '#3b82f6', label: 'Ocupado' },
  pago:       { cor: '#22c55e', label: 'Pago no mês' },
  vago:       { cor: '#94a3b8', label: 'Vago' },
  manutencao: { cor: '#f97316', label: 'Manutenção' },
  reservado:  { cor: '#eab308', label: 'Reservado' }
}

export default function Casas() {
  const { org } = useOrg()
  const navigate = useNavigate()
  const [casas, setCasas] = useState([])
  const [quartos, setQuartos] = useState([])
  const [contratos, setContratos] = useState([])   // vigentes
  const [pagos, setPagos] = useState(() => new Set()) // contrato_id pagos no mês
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const mes = mesAtual()
    const [{ data: cs, error }, { data: qs }, { data: ctr }, { data: recs }] = await Promise.all([
      supabase.from('casas').select('*').order('nome'),
      supabase.from('quartos').select('id, casa_id, identificacao, status, valor_final'),
      supabase.from('contratos')
        .select('id, quarto_id, dia_vencimento, valor_aluguel, status, inquilinos(nome)')
        .in('status', ['ativo', 'inadimplente', 'pendente']),
      supabase.from('recebimentos').select('contrato_id, status').eq('competencia', competenciaISO(mes))
    ])
    if (error) setErro(error.message)
    setCasas(cs || [])
    setQuartos(qs || [])
    setContratos(ctr || [])
    const s = new Set()
    for (const r of recs || []) if (r.status === 'pago') s.add(r.contrato_id)
    setPagos(s)
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // Contrato vigente por quarto (p/ inquilino + vencimento).
  const contratoPorQuarto = useMemo(() => {
    const m = new Map()
    for (const c of contratos) if (VIGENTE.has(c.status)) m.set(c.quarto_id, c)
    return m
  }, [contratos])

  // Monta, por casa, a lista de quartos já com estado visual + números do cabeçalho.
  const painel = useMemo(() => {
    const mes = mesAtual()
    const porCasa = new Map()
    for (const q of quartos) {
      const c = contratoPorQuarto.get(q.id)
      let estado, dias = null, atraso = 0, inquilino = null
      if (q.status === 'manutencao') estado = 'manutencao'
      else if (c) {
        inquilino = c.inquilinos?.nome || null
        const pago = pagos.has(c.id)
        const venc = vencimentoNaCompetencia(c.dia_vencimento, mes)
        dias = venc ? diasAte(venc) : null
        if (pago) estado = 'pago'
        else if (dias != null && dias < 0) { estado = 'atrasado'; atraso = -dias }
        else estado = 'ocupado'
      } else if (q.status === 'reservado') estado = 'reservado'
      else estado = 'vago'

      const item = { ...q, estado, atraso, inquilino, contrato: c || null }
      if (!porCasa.has(q.casa_id)) porCasa.set(q.casa_id, [])
      porCasa.get(q.casa_id).push(item)
    }
    // ordena quartos naturalmente dentro da casa
    for (const arr of porCasa.values()) arr.sort((a, b) => compararNatural(a.identificacao, b.identificacao))
    return porCasa
  }, [quartos, contratoPorQuarto, pagos])

  function resumoCasa(lista) {
    const r = { total: lista.length, ocupados: 0, vagos: 0, atrasados: 0, receita: 0 }
    for (const q of lista) {
      if (q.estado === 'vago') r.vagos++
      if (q.estado === 'ocupado' || q.estado === 'pago' || q.estado === 'atrasado') {
        r.ocupados++
        r.receita += Number(q.contrato?.valor_aluguel || q.valor_final || 0)
      }
      if (q.estado === 'atrasado') r.atrasados++
    }
    return r
  }

  function abrirNova() { setErro(''); setEditando({ ...vazia }) }
  function abrirEdicao(c) {
    setErro('')
    setEditando({ ...c, aluguel_mae: c.aluguel_mae ?? '', qtd_quartos_ref: c.qtd_quartos_ref ?? '' })
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
    const n = (painel.get(c.id) || []).length
    const aviso = n > 0
      ? `Excluir "${c.nome}"? Isso apaga também os ${n} quarto(s) e os dados ligados a eles.`
      : `Excluir "${c.nome}"?`
    if (!window.confirm(aviso)) return
    const { error } = await supabase.from('casas').delete().eq('id', c.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1>Casas &amp; Quartos</h1>
          <p className="sub" style={{ margin: 0 }}>Cada casa com todos os seus quartos, ocupação e quem está atrasado no mês.</p>
        </div>
        <button className="secundario" onClick={() => navigate('/importar')}>⬆ Importar planilha</button>
        <button className="ouro" onClick={abrirNova}>+ Nova casa</button>
      </div>

      {/* Legenda */}
      <div className="mt" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '.78rem' }}>
        {['pago', 'ocupado', 'atrasado', 'vago', 'manutencao'].map(k => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: ESTADO[k].cor, display: 'inline-block' }} />
            {ESTADO[k].label}
          </span>
        ))}
      </div>

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : casas.length === 0 ? (
        <div className="card mt">
          <strong>Nenhuma casa ainda</strong>
          <p className="sub">Cadastre a primeira casa (ou importe uma planilha) para começar.</p>
          <button className="ouro" onClick={abrirNova}>+ Nova casa</button>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 16 }}>
          {casas.map(c => {
            const lista = painel.get(c.id) || []
            const r = resumoCasa(lista)
            return (
              <div key={c.id} className="card">
                {/* Cabeçalho da casa */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '1.05rem' }}>{c.nome}</strong>
                      {!c.ativo && <span className="tag" style={{ background: 'var(--surface-2)' }}>inativa</span>}
                      {r.atrasados > 0 && (
                        <span className="tag" style={{ background: '#ef444422', color: '#ef4444', border: '1px solid #ef444455' }}>
                          {r.atrasados} atrasado(s)
                        </span>
                      )}
                    </div>
                    <div className="sub" style={{ margin: '3px 0 0' }}>
                      {r.ocupados}/{r.total} ocupados · {r.vagos} vago(s) · {formatarMoeda(r.receita)}/mês
                      {c.endereco ? ` · ${c.endereco}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="secundario" onClick={() => navigate(`/casas/${c.id}/quartos`)}>Quartos</button>
                    <button className="secundario" onClick={() => navigate(`/casas/${c.id}/composicao`)}>Composição</button>
                    <button className="secundario" onClick={() => abrirEdicao(c)}>Editar</button>
                    <button className="secundario" onClick={() => excluir(c)} title="Excluir">🗑</button>
                  </div>
                </div>

                {/* Grade de quartos */}
                {lista.length === 0 ? (
                  <p className="sub" style={{ marginTop: 10 }}>
                    Sem quartos. <button className="secundario" style={{ padding: '4px 10px' }} onClick={() => navigate(`/casas/${c.id}/quartos`)}>+ cadastrar</button>
                  </p>
                ) : (
                  <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                    {lista.map(q => {
                      const e = ESTADO[q.estado] || ESTADO.vago
                      return (
                        <button key={q.id} onClick={() => navigate(`/casas/${c.id}/quartos`)}
                          title={`${q.identificacao} · ${e.label}${q.inquilino ? ' · ' + q.inquilino : ''}`}
                          style={{
                            textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                            background: e.cor + '18', border: `1px solid ${e.cor}66`, borderLeft: `4px solid ${e.cor}`,
                            color: 'inherit', display: 'flex', flexDirection: 'column', gap: 2, minHeight: 56
                          }}>
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <strong style={{ fontSize: '.85rem' }}>{q.identificacao}</strong>
                            <span style={{ width: 9, height: 9, borderRadius: '50%', background: e.cor, flexShrink: 0 }} />
                          </span>
                          <span className="sub" style={{ fontSize: '.72rem', color: e.cor, fontWeight: 600 }}>
                            {q.estado === 'atrasado' ? `Atrasado ${q.atraso}d` : e.label}
                          </span>
                          {q.inquilino && (
                            <span className="sub" style={{ fontSize: '.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {q.inquilino}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editando && (
        <Modal titulo={editando.id ? 'Editar casa' : 'Nova casa'} onFechar={() => setEditando(null)}>
          <form onSubmit={salvar}>
            <label>Nome *</label>
            <input value={editando.nome} autoFocus
                   onChange={e => setEditando({ ...editando, nome: e.target.value })}
                   placeholder="Ex.: Casa 01 / Rua X, 123" />

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
