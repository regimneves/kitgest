import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, parseMoeda, formatarCompetencia } from '../lib/format'
import { calcularRateio, despesasDaCompetencia } from '../lib/rateio'
import Modal from '../components/Modal'

const TIPOS = {
  energia: 'Energia', agua: 'Água', gas: 'Gás', internet: 'Internet',
  iptu: 'IPTU', limpeza: 'Limpeza', seguro: 'Seguro', outro: 'Outro'
}
const CRITERIOS = { igual: 'Igual entre quartos', area_m2: 'Por área (m²)', moradores: 'Por nº de moradores' }
const mesAtual = () => new Date().toISOString().slice(0, 7)
const despVazia = () => ({ id: null, tipo: 'energia', descricao: '', valor: '', recorrente: true, competencia: mesAtual() })

export default function Composicao() {
  const { casaId } = useParams()
  const { org } = useOrg()
  const [casa, setCasa] = useState(null)
  const [quartos, setQuartos] = useState([])
  const [despesas, setDespesas] = useState([])
  const [competencia, setCompetencia] = useState(mesAtual())
  const [carregando, setCarregando] = useState(true)
  const [despEdit, setDespEdit] = useState(null)
  const [aplicando, setAplicando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [{ data: c }, { data: qs }, { data: ds, error }] = await Promise.all([
      supabase.from('casas').select('*').eq('id', casaId).maybeSingle(),
      supabase.from('quartos').select('*').eq('casa_id', casaId).order('identificacao'),
      supabase.from('despesas_casa').select('*').eq('casa_id', casaId).order('tipo')
    ])
    if (error) setErro(error.message)
    setCasa(c || null)
    setQuartos(qs || [])
    setDespesas(ds || [])
    setCarregando(false)
  }, [casaId])

  useEffect(() => { carregar() }, [carregar])

  async function mudarCriterio(criterio) {
    setCasa(c => ({ ...c, criterio_rateio: criterio }))
    await supabase.from('casas').update({ criterio_rateio: criterio }).eq('id', casaId)
  }

  // --- Despesas ---
  async function salvarDespesa(e) {
    e.preventDefault()
    setErro('')
    const payload = {
      org_id: org.id, casa_id: casaId, tipo: despEdit.tipo,
      descricao: despEdit.descricao?.trim() || null, valor: parseMoeda(despEdit.valor),
      recorrente: despEdit.recorrente,
      competencia: despEdit.recorrente ? null : (despEdit.competencia ? `${despEdit.competencia}-01` : null)
    }
    const q = despEdit.id
      ? supabase.from('despesas_casa').update(payload).eq('id', despEdit.id)
      : supabase.from('despesas_casa').insert(payload)
    const { error } = await q
    if (error) { setErro(error.message); return }
    setDespEdit(null)
    carregar()
  }
  async function excluirDespesa(d) {
    if (!window.confirm(`Excluir a despesa "${TIPOS[d.tipo]}"?`)) return
    const { error } = await supabase.from('despesas_casa').delete().eq('id', d.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  const despesasMes = useMemo(() => despesasDaCompetencia(despesas, competencia), [despesas, competencia])
  const calc = useMemo(
    () => calcularRateio(quartos, despesasMes, casa?.criterio_rateio || 'igual'),
    [quartos, despesasMes, casa]
  )
  const totalCobrar = useMemo(() => calc.porQuarto.reduce((s, p) => s + p.valor_final, 0), [calc])

  async function aplicar() {
    if (!quartos.length) { setErro('Cadastre quartos nesta casa antes de aplicar.'); return }
    if (!window.confirm(`Aplicar a composição de ${formatarCompetencia(`${competencia}-01`)} a ${quartos.length} quarto(s)? Isso atualiza o valor cobrado de cada quarto.`)) return
    setErro(''); setOk(''); setAplicando(true)
    try {
      const compData = `${competencia}-01`
      // snapshot por quarto (upsert por quarto_id+competencia)
      const snaps = calc.porQuarto.map(p => ({
        org_id: org.id, quarto_id: p.quarto_id, competencia: compData,
        base: p.base, total_rateio: p.total_rateio, valor_final: p.valor_final, detalhe: p.detalhe
      }))
      const { error: e1 } = await supabase.from('quarto_rateio')
        .upsert(snaps, { onConflict: 'quarto_id,competencia' })
      if (e1) throw e1
      // aplica o valor_final em cada quarto
      for (const p of calc.porQuarto) {
        const { error } = await supabase.from('quartos').update({ valor_final: p.valor_final }).eq('id', p.quarto_id)
        if (error) throw error
      }
      setOk(`Composição aplicada. Valor dos quartos atualizado para ${formatarCompetencia(compData)}.`)
      carregar()
    } catch (err) { setErro(err.message) } finally { setAplicando(false) }
  }

  if (carregando) return <p className="sub">Carregando…</p>

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <Link to="/casas" className="sub" style={{ textDecoration: 'none' }}>← Casas</Link>
      <h1 style={{ marginTop: 6 }}>Composição do aluguel {casa ? `· ${casa.nome}` : ''}</h1>
      <p className="sub" style={{ margin: 0 }}>As despesas da casa são rateadas e embutidas no valor de cada quarto.</p>

      <div className="card mt">
        <div className="linha">
          <div>
            <label>Competência</label>
            <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} />
          </div>
          <div>
            <label>Critério de rateio</label>
            <select value={casa?.criterio_rateio || 'igual'} onChange={e => mudarCriterio(e.target.value)}>
              {Object.entries(CRITERIOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </div>
        </div>
        {calc.criterioEfetivo !== (casa?.criterio_rateio || 'igual') && (
          <p className="sub" style={{ marginTop: 6, color: 'var(--cor-ouro)' }}>
            Sem dados para “{CRITERIOS[casa?.criterio_rateio]}” (falta área/capacidade nos quartos) — usando rateio igual.
          </p>
        )}
      </div>

      {/* Despesas do mês */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
        <h1 style={{ flex: 1, fontSize: '1.2rem' }}>Despesas</h1>
        <button className="secundario" onClick={() => { setErro(''); setDespEdit(despVazia()) }}>+ Despesa</button>
      </div>
      {despesas.length === 0 ? (
        <p className="sub mt">Nenhuma despesa cadastrada. Adicione energia, água, etc. para ratear.</p>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 8 }}>
          {despesas.map(d => {
            const noMes = despesasMes.some(x => x.id === d.id)
            return (
              <div key={d.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', opacity: noMes ? 1 : 0.55 }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <strong>{TIPOS[d.tipo]}</strong>{d.descricao ? <span className="sub"> · {d.descricao}</span> : null}
                  <div className="sub" style={{ margin: '2px 0 0' }}>
                    {d.recorrente ? 'todo mês' : `só ${d.competencia ? formatarCompetencia(d.competencia) : '—'}`}
                    {!noMes ? ' · fora deste mês' : ''}
                  </div>
                </div>
                <strong>{formatarMoeda(d.valor)}</strong>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="secundario" onClick={() => { setErro(''); setDespEdit({ ...d, valor: d.valor ?? '', competencia: d.competencia ? String(d.competencia).slice(0, 7) : mesAtual() }) }}>Editar</button>
                  <button className="secundario" onClick={() => excluirDespesa(d)} title="Excluir">🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Prévia do rateio */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
        <h1 style={{ flex: 1, fontSize: '1.2rem' }}>Prévia · {formatarCompetencia(`${competencia}-01`)}</h1>
        <span className="sub">despesas do mês: <b>{formatarMoeda(calc.totalDespesas)}</b></span>
      </div>

      {quartos.length === 0 ? (
        <div className="card mt"><p className="sub" style={{ margin: 0 }}>Nenhum quarto nesta casa. <Link to={`/casas/${casaId}/quartos`}>Cadastre os quartos</Link> para ver o rateio.</p></div>
      ) : (
        <div className="card mt" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--borda)' }}>
                <th style={th}>Quarto</th>
                <th style={thR}>Base</th>
                <th style={thR}>Rateio</th>
                <th style={thR}>Valor final</th>
              </tr>
            </thead>
            <tbody>
              {calc.porQuarto.map(p => {
                const q = quartos.find(x => x.id === p.quarto_id)
                return (
                  <tr key={p.quarto_id} style={{ borderBottom: '1px solid var(--borda)' }}>
                    <td style={td}>{q?.identificacao || '—'}</td>
                    <td style={tdR}>{formatarMoeda(p.base)}</td>
                    <td style={tdR}>+ {formatarMoeda(p.total_rateio)}</td>
                    <td style={{ ...tdR, fontWeight: 700 }}>{formatarMoeda(p.valor_final)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...td, fontWeight: 700 }}>Total</td>
                <td style={tdR}></td>
                <td style={{ ...tdR, fontWeight: 700 }}>{formatarMoeda(calc.totalDespesas)}</td>
                <td style={{ ...tdR, fontWeight: 700 }}>{formatarMoeda(totalCobrar)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {erro && <div className="erro">{erro}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="linha mt" style={{ flexWrap: 'wrap' }}>
        <span className="sub" style={{ flex: 1 }}>Aplicar grava o snapshot do mês e atualiza o valor cobrado de cada quarto.</span>
        <button className="ouro" onClick={aplicar} disabled={aplicando || quartos.length === 0}>
          {aplicando ? 'Aplicando…' : `Aplicar a ${formatarCompetencia(`${competencia}-01`)}`}
        </button>
      </div>

      {despEdit && (
        <Modal titulo={despEdit.id ? 'Editar despesa' : 'Nova despesa'} onFechar={() => setDespEdit(null)}>
          <form onSubmit={salvarDespesa}>
            <div className="linha">
              <div>
                <label>Tipo</label>
                <select value={despEdit.tipo} onChange={e => setDespEdit({ ...despEdit, tipo: e.target.value })}>
                  {Object.entries(TIPOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </div>
              <div>
                <label>Valor (R$)</label>
                <input inputMode="decimal" value={despEdit.valor}
                       onChange={e => setDespEdit({ ...despEdit, valor: e.target.value })} placeholder="0,00" />
              </div>
            </div>
            <label>Descrição</label>
            <input value={despEdit.descricao || ''}
                   onChange={e => setDespEdit({ ...despEdit, descricao: e.target.value })} placeholder="opcional" />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={despEdit.recorrente}
                     onChange={e => setDespEdit({ ...despEdit, recorrente: e.target.checked })} />
              Recorrente (entra em todo mês)
            </label>
            {!despEdit.recorrente && (
              <>
                <label>Competência (mês)</label>
                <input type="month" value={despEdit.competencia}
                       onChange={e => setDespEdit({ ...despEdit, competencia: e.target.value })} />
              </>
            )}

            {erro && <div className="erro">{erro}</div>}
            <div className="linha mt">
              <button type="button" className="secundario" onClick={() => setDespEdit(null)}>Cancelar</button>
              <button type="submit" className="ouro">Salvar</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

const th = { padding: '10px 12px', fontSize: '.85rem', color: 'var(--texto-fraco)' }
const thR = { ...th, textAlign: 'right' }
const td = { padding: '10px 12px' }
const tdR = { ...td, textAlign: 'right' }
