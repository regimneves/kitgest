import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, parseMoeda, formatarData } from '../lib/format'
import { TIPO_CONTA, mesAtual, competenciaISO, diasAte } from '../lib/gestao'
import Modal from '../components/Modal'

const vazio = () => ({
  id: null, casa_id: '', tipo: 'aluguel_mae', descricao: '',
  valor: '', vencimento: '', pago: false, observacoes: ''
})

export default function ContasPagar() {
  const { org } = useOrg()
  const [contas, setContas] = useState([])
  const [casas, setCasas] = useState([])
  const [competencia, setCompetencia] = useState(mesAtual())
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [filtro, setFiltro] = useState('todas') // todas | aberto | pagas
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [{ data: cts, error }, { data: cs }] = await Promise.all([
      supabase.from('contas_pagar')
        .select('*, casas(nome)')
        .eq('competencia', competenciaISO(competencia))
        .order('vencimento', { ascending: true, nullsFirst: false }),
      supabase.from('casas').select('id, nome, aluguel_mae').order('nome')
    ])
    if (error) setErro(error.message)
    setContas(cts || [])
    setCasas(cs || [])
    setCarregando(false)
  }, [competencia])

  useEffect(() => { carregar() }, [carregar])

  function abrirNovo() {
    setErro('')
    const [ano, mes] = competencia.split('-')
    setEditando({ ...vazio(), vencimento: `${ano}-${mes}-10` })
  }
  function abrirEdicao(c) {
    setErro('')
    setEditando({
      id: c.id, casa_id: c.casa_id || '', tipo: c.tipo, descricao: c.descricao || '',
      valor: c.valor ?? '', vencimento: c.vencimento || '', pago: !!c.pago,
      observacoes: c.observacoes || ''
    })
  }

  async function salvar(e) {
    e.preventDefault()
    if (parseMoeda(editando.valor) <= 0) { setErro('Informe o valor da conta.'); return }
    setErro(''); setSalvando(true)
    try {
      const payload = {
        org_id: org.id,
        casa_id: editando.casa_id || null,
        tipo: editando.tipo,
        descricao: editando.descricao?.trim() || null,
        valor: parseMoeda(editando.valor),
        competencia: competenciaISO(competencia),
        vencimento: editando.vencimento || null,
        pago: editando.pago,
        pago_em: editando.pago ? new Date().toISOString() : null,
        observacoes: editando.observacoes?.trim() || null
      }
      const q = editando.id
        ? supabase.from('contas_pagar').update(payload).eq('id', editando.id)
        : supabase.from('contas_pagar').insert(payload)
      const { error } = await q
      if (error) throw error
      setEditando(null)
      carregar()
    } catch (err) { setErro(err.message) } finally { setSalvando(false) }
  }

  // Marca pago / não pago no toque.
  async function alternarPago(c) {
    const novo = !c.pago
    const { error } = await supabase.from('contas_pagar')
      .update({ pago: novo, pago_em: novo ? new Date().toISOString() : null })
      .eq('id', c.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  async function excluir(c) {
    if (!window.confirm('Excluir esta conta a pagar?')) return
    const { error } = await supabase.from('contas_pagar').delete().eq('id', c.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  // Gera as contas recorrentes do mês: aluguel-mãe de cada casa + despesas recorrentes.
  // Não duplica: pula (casa,tipo) que já existir na competência.
  async function gerarDoMes() {
    setErro(''); setGerando(true)
    try {
      const comp = competenciaISO(competencia)
      const { data: desp } = await supabase.from('despesas_casa')
        .select('casa_id, tipo, valor, descricao, recorrente')
      const existentes = new Set(contas.map(c => `${c.casa_id || ''}|${c.tipo}`))
      const novas = []
      const [ano, mes] = competencia.split('-')
      // aluguel-mãe por casa
      for (const casa of casas) {
        if (Number(casa.aluguel_mae) > 0 && !existentes.has(`${casa.id}|aluguel_mae`)) {
          novas.push({
            org_id: org.id, casa_id: casa.id, tipo: 'aluguel_mae',
            descricao: `Aluguel da ${casa.nome}`, valor: Number(casa.aluguel_mae),
            competencia: comp, vencimento: `${ano}-${mes}-05`, pago: false
          })
          existentes.add(`${casa.id}|aluguel_mae`)
        }
      }
      // despesas recorrentes por casa
      for (const d of desp || []) {
        if (!d.recorrente) continue
        const chave = `${d.casa_id || ''}|${d.tipo}`
        if (existentes.has(chave)) continue
        novas.push({
          org_id: org.id, casa_id: d.casa_id, tipo: d.tipo,
          descricao: d.descricao || null, valor: Number(d.valor || 0),
          competencia: comp, vencimento: `${ano}-${mes}-15`, pago: false
        })
        existentes.add(chave)
      }
      if (novas.length === 0) {
        setErro('Nada novo a gerar: as contas recorrentes deste mês já existem.')
      } else {
        const { error } = await supabase.from('contas_pagar').insert(novas)
        if (error) throw error
      }
      carregar()
    } catch (err) { setErro(err.message) } finally { setGerando(false) }
  }

  const resumo = useMemo(() => {
    let total = 0, pago = 0
    for (const c of contas) { total += Number(c.valor || 0); if (c.pago) pago += Number(c.valor || 0) }
    return { total, pago, aberto: total - pago }
  }, [contas])

  const lista = useMemo(() => {
    if (filtro === 'aberto') return contas.filter(c => !c.pago)
    if (filtro === 'pagas') return contas.filter(c => c.pago)
    return contas
  }, [contas, filtro])

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h1>Contas a pagar</h1>
          <p className="sub" style={{ margin: 0 }}>Aluguel das casas e despesas — o outro lado do caixa.</p>
        </div>
        <div>
          <label style={{ fontSize: '.8rem' }}>Competência</label>
          <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} />
        </div>
      </div>

      <div className="mt" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="ouro" onClick={abrirNovo}>+ Nova conta</button>
        <button className="secundario" onClick={gerarDoMes} disabled={gerando}>
          {gerando ? 'Gerando…' : '⤵ Gerar contas do mês'}
        </button>
      </div>

      {/* Resumo */}
      <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Kpi titulo="Total do mês" valor={formatarMoeda(resumo.total)} />
        <Kpi titulo="Pago" valor={formatarMoeda(resumo.pago)} cor="#22c55e" />
        <Kpi titulo="Em aberto" valor={formatarMoeda(resumo.aberto)} cor={resumo.aberto > 0 ? '#ef4444' : '#22c55e'} />
      </div>

      {contas.length > 0 && (
        <div className="mt" style={{ display: 'flex', gap: 8 }}>
          <button className={filtro === 'todas' ? 'ouro' : 'secundario'} onClick={() => setFiltro('todas')}>Todas</button>
          <button className={filtro === 'aberto' ? 'ouro' : 'secundario'} onClick={() => setFiltro('aberto')}>Em aberto</button>
          <button className={filtro === 'pagas' ? 'ouro' : 'secundario'} onClick={() => setFiltro('pagas')}>Pagas</button>
        </div>
      )}

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : contas.length === 0 ? (
        <div className="card mt">
          <strong>Nenhuma conta neste mês</strong>
          <p className="sub">Use <b>Gerar contas do mês</b> para trazer o aluguel das casas e as despesas recorrentes automaticamente, ou adicione manualmente.</p>
          <button className="ouro" onClick={gerarDoMes} disabled={gerando}>⤵ Gerar contas do mês</button>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 10 }}>
          {lista.map(c => {
            const dias = c.vencimento && !c.pago ? diasAte(new Date(c.vencimento + 'T00:00:00')) : null
            const vencida = dias != null && dias < 0
            const cor = c.pago ? '#22c55e' : vencida ? '#ef4444' : '#f97316'
            return (
              <div key={c.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderLeft: `4px solid ${cor}` }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{TIPO_CONTA[c.tipo] || c.tipo}</strong>
                    {c.pago
                      ? <span className="tag" style={tagCor('#22c55e')}>Pago</span>
                      : vencida
                        ? <span className="tag" style={tagCor('#ef4444')}>Vencida {(-dias)}d</span>
                        : <span className="tag" style={tagCor('#f97316')}>Em aberto</span>}
                  </div>
                  <div className="sub" style={{ margin: '4px 0 0' }}>
                    {c.casas?.nome ? `${c.casas.nome} · ` : ''}{c.descricao || '—'}
                    {c.vencimento ? ` · vence ${formatarData(c.vencimento)}` : ''}
                  </div>
                </div>
                <strong style={{ fontSize: '1.05rem' }}>{formatarMoeda(c.valor)}</strong>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className={c.pago ? 'secundario' : 'ouro'} onClick={() => alternarPago(c)}>
                    {c.pago ? 'Desmarcar' : 'Marcar pago'}
                  </button>
                  <button className="secundario" onClick={() => abrirEdicao(c)}>Editar</button>
                  <button className="secundario" onClick={() => excluir(c)} title="Excluir">🗑</button>
                </div>
              </div>
            )
          })}
          {lista.length === 0 && <p className="sub">Nada neste filtro.</p>}
        </div>
      )}

      {editando && (
        <Modal titulo={editando.id ? 'Editar conta' : 'Nova conta a pagar'} onFechar={() => setEditando(null)}>
          <form onSubmit={salvar}>
            <div className="linha">
              <div>
                <label>Tipo</label>
                <select value={editando.tipo} onChange={e => setEditando({ ...editando, tipo: e.target.value })}>
                  {Object.entries(TIPO_CONTA).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label>Casa</label>
                <select value={editando.casa_id} onChange={e => setEditando({ ...editando, casa_id: e.target.value })}>
                  <option value="">— geral —</option>
                  {casas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            </div>

            <div className="linha">
              <div>
                <label>Valor (R$)</label>
                <input inputMode="decimal" value={editando.valor} autoFocus
                       onChange={e => setEditando({ ...editando, valor: e.target.value })} placeholder="0,00" />
              </div>
              <div>
                <label>Vencimento</label>
                <input type="date" value={editando.vencimento}
                       onChange={e => setEditando({ ...editando, vencimento: e.target.value })} />
              </div>
            </div>

            <label>Descrição</label>
            <input value={editando.descricao}
                   onChange={e => setEditando({ ...editando, descricao: e.target.value })}
                   placeholder="Ex.: Energia CEMIG" />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={editando.pago}
                     onChange={e => setEditando({ ...editando, pago: e.target.checked })} />
              Já está pago
            </label>

            <label>Observações</label>
            <textarea rows={2} value={editando.observacoes}
                      onChange={e => setEditando({ ...editando, observacoes: e.target.value })} />

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

function Kpi({ titulo, valor, cor }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="sub" style={{ fontSize: '.78rem' }}>{titulo}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, margin: '2px 0', color: cor || 'inherit' }}>{valor}</div>
    </div>
  )
}

const tagCor = (c) => ({ background: c + '22', color: c, border: `1px solid ${c}55` })
