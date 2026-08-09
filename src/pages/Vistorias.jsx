import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatarData } from '../lib/format'

const TIPO = {
  entrada: { label: 'Entrada', cor: '#22c55e' },
  saida:   { label: 'Saída',   cor: '#f97316' }
}

export default function Vistorias() {
  const navigate = useNavigate()
  const [vistorias, setVistorias] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [temQuarto, setTemQuarto] = useState(true)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [{ data: vs, error }, { count }] = await Promise.all([
      supabase.from('vistorias')
        .select('*, quartos(identificacao, casas(nome)), vistoria_itens(count)')
        .order('realizada_em', { ascending: false, nullsFirst: false })
        .order('criado_em', { ascending: false }),
      supabase.from('quartos').select('id', { count: 'exact', head: true })
    ])
    if (error) setErro(error.message)
    setVistorias(vs || [])
    setTemQuarto((count || 0) > 0)
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function baixarLaudo(v) {
    if (!v.laudo_pdf_url) return
    setErro('')
    try {
      const { data, error } = await supabase.storage.from('laudos').createSignedUrl(v.laudo_pdf_url, 120)
      if (error) throw error
      window.open(data.signedUrl, '_blank')
    } catch (err) { setErro(err.message) }
  }

  async function excluir(v) {
    if (!window.confirm('Excluir esta vistoria e seus itens?')) return
    const { error } = await supabase.from('vistorias').delete().eq('id', v.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Vistorias</h1>
          <p className="sub" style={{ margin: 0 }}>Checklist de entrada/saída com fotos, assinatura e laudo em PDF.</p>
        </div>
        <button className="ouro" onClick={() => navigate('/vistorias/nova')} disabled={!temQuarto}>+ Nova vistoria</button>
      </div>

      {!temQuarto && !carregando && (
        <div className="card mt" style={{ borderColor: 'var(--cor-ouro)' }}>
          <strong>Cadastre um quarto primeiro</strong>
          <p className="sub" style={{ marginBottom: 0 }}>A vistoria é sempre de um quarto (em <b>Casas</b>).</p>
        </div>
      )}

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : vistorias.length === 0 ? (
        <div className="card mt">
          <strong>Nenhuma vistoria ainda</strong>
          <p className="sub">Faça a vistoria de entrada ao receber um inquilino, e a de saída na devolução.</p>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 10 }}>
          {vistorias.map(v => {
            const t = TIPO[v.tipo] || TIPO.entrada
            const quartoTxt = v.quartos
              ? `${v.quartos.casas?.nome ? v.quartos.casas.nome + ' · ' : ''}${v.quartos.identificacao}`
              : '—'
            const nItens = v.vistoria_itens?.[0]?.count ?? 0
            return (
              <div key={v.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{quartoTxt}</strong>
                    <span className="tag" style={{ background: t.cor + '22', color: t.cor, border: `1px solid ${t.cor}55` }}>{t.label}</span>
                    {v.laudo_pdf_url && <span className="tag" style={{ background: 'var(--surface-2)' }}>laudo ✓</span>}
                  </div>
                  <div className="sub" style={{ margin: '4px 0 0' }}>
                    {v.realizada_em ? formatarData(new Date(v.realizada_em).toISOString()) : '—'}
                    {` · ${nItens} item(ns)`}
                    {v.responsavel ? ` · ${v.responsavel}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {v.laudo_pdf_url && <button className="secundario" onClick={() => baixarLaudo(v)}>Laudo</button>}
                  <button className="secundario" onClick={() => navigate(`/vistorias/${v.id}`)}>Abrir</button>
                  <button className="secundario" onClick={() => excluir(v)} title="Excluir">🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
