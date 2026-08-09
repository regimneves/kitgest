import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { comprimirImagem, blobParaDataURL } from '../lib/imagem'
import { gerarLaudoPDF } from '../lib/laudo'
import AssinaturaPad from '../components/AssinaturaPad'

const CONDICOES = {
  ok:         { label: 'OK',         cor: '#22c55e' },
  avaria:     { label: 'Avaria',     cor: '#ef4444' },
  observacao: { label: 'Observação', cor: '#eab308' }
}

// Checklist inicial sugerido (o operador edita/remove/adiciona).
const TEMPLATE = [
  ['Quarto', 'Paredes / pintura'], ['Quarto', 'Piso'], ['Quarto', 'Teto'],
  ['Quarto', 'Porta / fechadura'], ['Quarto', 'Janela'], ['Quarto', 'Tomadas / interruptores'],
  ['Banheiro', 'Vaso sanitário'], ['Banheiro', 'Pia / torneira'], ['Banheiro', 'Chuveiro'],
  ['Cozinha', 'Pia / bancada'], ['Geral', 'Chaves entregues'], ['Geral', 'Limpeza']
]
const novoItem = (ambiente = '', item = '') => ({
  _key: crypto.randomUUID(), id: null, ambiente, item, condicao: 'ok', descricao: '', fotos: []
})

const hoje = () => new Date().toISOString().slice(0, 10)

export default function VistoriaEditor() {
  const { vistoriaId } = useParams()
  const editandoExistente = vistoriaId && vistoriaId !== 'nova'
  const { org } = useOrg()
  const navigate = useNavigate()

  const [quartos, setQuartos] = useState([])
  const [cab, setCab] = useState({ quarto_id: '', tipo: 'entrada', responsavel: '', realizada_em: hoje(), observacoes: '' })
  const [itens, setItens] = useState(() => TEMPLATE.map(([a, i]) => novoItem(a, i)))
  const [assinatura, setAssinatura] = useState({ dataURL: null, path: null, mudou: false })
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data: qs } = await supabase
      .from('quartos').select('id, identificacao, casa_id, casas(nome)').order('identificacao')
    setQuartos(qs || [])

    if (editandoExistente) {
      const [{ data: v, error }, { data: its }] = await Promise.all([
        supabase.from('vistorias').select('*').eq('id', vistoriaId).maybeSingle(),
        supabase.from('vistoria_itens').select('*').eq('vistoria_id', vistoriaId).order('criado_em')
      ])
      if (error) setErro(error.message)
      if (v) {
        setCab({
          quarto_id: v.quarto_id, tipo: v.tipo, responsavel: v.responsavel || '',
          realizada_em: v.realizada_em ? String(v.realizada_em).slice(0, 10) : hoje(),
          observacoes: v.observacoes || ''
        })
        // assinatura existente → URL assinada p/ preview
        if (v.assinatura_url) {
          const { data: s } = await supabase.storage.from('assinaturas').createSignedUrl(v.assinatura_url, 3600)
          setAssinatura({ dataURL: s?.signedUrl || null, path: v.assinatura_url, mudou: false })
        }
      }
      // itens + URLs assinadas das fotos
      const carregados = []
      for (const it of its || []) {
        const paths = Array.isArray(it.fotos) ? it.fotos : []
        const fotos = []
        for (const p of paths) {
          const { data: su } = await supabase.storage.from('vistoria-fotos').createSignedUrl(p, 3600)
          fotos.push({ path: p, src: su?.signedUrl || null })
        }
        carregados.push({ _key: crypto.randomUUID(), id: it.id, ambiente: it.ambiente || '', item: it.item, condicao: it.condicao, descricao: it.descricao || '', fotos })
      }
      if (carregados.length) setItens(carregados)
    }
    setCarregando(false)
  }, [vistoriaId, editandoExistente])

  useEffect(() => { carregar() }, [carregar])

  function setItem(key, patch) {
    setItens(arr => arr.map(it => it._key === key ? { ...it, ...patch } : it))
  }
  function removerItem(key) {
    setItens(arr => arr.filter(it => it._key !== key))
  }

  async function adicionarFoto(key, e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErro('')
    try {
      const { blob, previa } = await comprimirImagem(file)
      const path = `${org.id}/${crypto.randomUUID()}.jpg`
      const { error } = await supabase.storage.from('vistoria-fotos').upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      setItens(arr => arr.map(it =>
        it._key === key ? { ...it, fotos: [...it.fotos, { path, src: previa, previa }] } : it))
    } catch (err) { setErro('Falha na foto: ' + err.message) }
  }

  async function removerFoto(key, idx) {
    const it = itens.find(x => x._key === key)
    const foto = it?.fotos[idx]
    if (foto?.path) supabase.storage.from('vistoria-fotos').remove([foto.path]) // best-effort
    setItem(key, { fotos: it.fotos.filter((_, i) => i !== idx) })
  }

  function validar() {
    if (!cab.quarto_id) return 'Escolha o quarto.'
    const comItem = itens.filter(i => i.item.trim())
    if (comItem.length === 0) return 'Adicione ao menos um item ao checklist.'
    return ''
  }

  // Faz upload da assinatura (se mudou) e devolve o path a gravar.
  async function persistirAssinatura() {
    if (!assinatura.mudou) return assinatura.path
    if (!assinatura.dataURL) return null
    const blob = await (await fetch(assinatura.dataURL)).blob()
    const path = `${org.id}/${crypto.randomUUID()}.png`
    const { error } = await supabase.storage.from('assinaturas').upload(path, blob, { contentType: 'image/png' })
    if (error) throw error
    return path
  }

  async function salvar() {
    const v = validar()
    if (v) { setErro(v); return null }
    setErro(''); setOk(''); setSalvando(true)
    try {
      const assinaturaPath = await persistirAssinatura()
      const cabPayload = {
        org_id: org.id, quarto_id: cab.quarto_id, tipo: cab.tipo,
        responsavel: cab.responsavel?.trim() || null,
        realizada_em: cab.realizada_em ? new Date(cab.realizada_em).toISOString() : new Date().toISOString(),
        observacoes: cab.observacoes?.trim() || null,
        assinatura_url: assinaturaPath
      }

      let vid = editandoExistente ? vistoriaId : null
      if (editandoExistente) {
        const { error } = await supabase.from('vistorias').update(cabPayload).eq('id', vistoriaId)
        if (error) throw error
        await supabase.from('vistoria_itens').delete().eq('vistoria_id', vistoriaId)
      } else {
        const { data, error } = await supabase.from('vistorias').insert(cabPayload).select('id').single()
        if (error) throw error
        vid = data.id
      }

      const itensPayload = itens.filter(i => i.item.trim()).map(i => ({
        org_id: org.id, vistoria_id: vid, ambiente: i.ambiente?.trim() || null,
        item: i.item.trim(), condicao: i.condicao, descricao: i.descricao?.trim() || null,
        fotos: i.fotos.map(f => f.path)
      }))
      if (itensPayload.length) {
        const { error } = await supabase.from('vistoria_itens').insert(itensPayload)
        if (error) throw error
      }

      setAssinatura(a => ({ ...a, path: assinaturaPath, mudou: false }))
      setOk('Vistoria salva.')
      setSalvando(false)
      return vid
    } catch (err) {
      setErro(err.message); setSalvando(false); return null
    }
  }

  async function salvarEGerarLaudo() {
    const vid = await salvar()
    if (!vid) return
    setGerando(true); setErro('')
    try {
      const casa = quartos.find(q => q.id === cab.quarto_id)?.casas || null
      const quarto = quartos.find(q => q.id === cab.quarto_id) || {}
      // prepara fotos como dataURL (usa a prévia local, senão baixa do storage)
      const itensLaudo = []
      for (const it of itens.filter(i => i.item.trim())) {
        const fotosDataUrls = []
        for (const f of it.fotos) {
          if (f.previa) fotosDataUrls.push(f.previa)
          else if (f.path) {
            const { data } = await supabase.storage.from('vistoria-fotos').download(f.path)
            if (data) fotosDataUrls.push(await blobParaDataURL(data))
          }
        }
        itensLaudo.push({ ambiente: it.ambiente, item: it.item, condicao: it.condicao, descricao: it.descricao, fotosDataUrls })
      }
      const blob = await gerarLaudoPDF({
        org, vistoria: { ...cab }, quarto, casa, itens: itensLaudo,
        assinaturaDataURL: assinatura.dataURL
      })
      // sobe pro bucket laudos + salva url; e baixa p/ o operador
      const path = `${org.id}/${vid}.pdf`
      await supabase.storage.from('laudos').upload(path, blob, { contentType: 'application/pdf', upsert: true })
      await supabase.from('vistorias').update({ laudo_pdf_url: path }).eq('id', vid)

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Laudo-${cab.tipo}-${(quarto.identificacao || 'quarto').replace(/\s+/g, '')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setOk('Laudo gerado e salvo.')
    } catch (err) {
      setErro('Falha ao gerar laudo: ' + err.message)
    } finally {
      setGerando(false)
    }
  }

  if (carregando) return <p className="sub">Carregando…</p>

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <Link to="/vistorias" className="sub" style={{ textDecoration: 'none' }}>← Vistorias</Link>
      <h1 style={{ marginTop: 6 }}>{editandoExistente ? 'Editar vistoria' : 'Nova vistoria'}</h1>

      <div className="card">
        <div className="linha">
          <div>
            <label>Quarto *</label>
            <select value={cab.quarto_id} onChange={e => setCab({ ...cab, quarto_id: e.target.value })}>
              <option value="">— escolher —</option>
              {quartos.map(q => {
                const casa = q.casas?.nome ? `${q.casas.nome} · ` : ''
                return <option key={q.id} value={q.id}>{casa}{q.identificacao}</option>
              })}
            </select>
          </div>
          <div>
            <label>Tipo</label>
            <select value={cab.tipo} onChange={e => setCab({ ...cab, tipo: e.target.value })}>
              <option value="entrada">Entrada (check-in)</option>
              <option value="saida">Saída (check-out)</option>
            </select>
          </div>
        </div>
        <div className="linha">
          <div>
            <label>Responsável</label>
            <input value={cab.responsavel} onChange={e => setCab({ ...cab, responsavel: e.target.value })}
                   placeholder="quem vistoriou" />
          </div>
          <div>
            <label>Data</label>
            <input type="date" value={cab.realizada_em} onChange={e => setCab({ ...cab, realizada_em: e.target.value })} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
        <h1 style={{ flex: 1, fontSize: '1.25rem' }}>Checklist</h1>
        <button className="secundario" onClick={() => setItens(a => [...a, novoItem()])}>+ Item</button>
      </div>

      <div className="mt" style={{ display: 'grid', gap: 10 }}>
        {itens.map(it => {
          const c = CONDICOES[it.condicao] || CONDICOES.ok
          return (
            <div key={it._key} className="card" style={{ borderLeft: `4px solid ${c.cor}` }}>
              <div className="linha">
                <div style={{ flex: '0 0 34%' }}>
                  <label>Ambiente</label>
                  <input value={it.ambiente} onChange={e => setItem(it._key, { ambiente: e.target.value })}
                         placeholder="ex.: Banheiro" />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Item</label>
                  <input value={it.item} onChange={e => setItem(it._key, { item: e.target.value })}
                         placeholder="ex.: Chuveiro" />
                </div>
              </div>
              <div className="linha">
                <div>
                  <label>Condição</label>
                  <select value={it.condicao} onChange={e => setItem(it._key, { condicao: e.target.value })}>
                    {Object.entries(CONDICOES).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label>Descrição / observação</label>
                  <input value={it.descricao} onChange={e => setItem(it._key, { descricao: e.target.value })}
                         placeholder={it.condicao === 'ok' ? 'opcional' : 'descreva a avaria/observação'} />
                </div>
              </div>

              {/* fotos */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                {it.fotos.map((f, idx) => (
                  <div key={idx} style={{ position: 'relative' }}>
                    <img src={f.src} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--borda)' }} />
                    <button type="button" onClick={() => removerFoto(it._key, idx)}
                            title="Remover foto"
                            style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
                  </div>
                ))}
                <label className="secundario" style={{ cursor: 'pointer', padding: '8px 12px', borderRadius: 8, fontSize: '.9rem' }}>
                  📷 Foto
                  <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                         onChange={e => adicionarFoto(it._key, e)} />
                </label>
                <span style={{ flex: 1 }} />
                <button type="button" className="secundario" onClick={() => removerItem(it._key)} title="Remover item">🗑</button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card mt">
        <label>Observações gerais</label>
        <textarea rows={2} value={cab.observacoes} onChange={e => setCab({ ...cab, observacoes: e.target.value })} />
        <label style={{ marginTop: 12 }}>Assinatura</label>
        <AssinaturaPad valorInicial={assinatura.dataURL}
                       onChange={d => setAssinatura({ dataURL: d, path: assinatura.path, mudou: true })} />
      </div>

      {erro && <div className="erro">{erro}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="linha mt" style={{ flexWrap: 'wrap' }}>
        <button className="secundario" onClick={() => navigate('/vistorias')}>Voltar</button>
        <span style={{ flex: 1 }} />
        <button className="secundario" onClick={salvar} disabled={salvando || gerando}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button className="ouro" onClick={salvarEGerarLaudo} disabled={salvando || gerando}>
          {gerando ? 'Gerando…' : 'Salvar + Laudo PDF'}
        </button>
      </div>
    </div>
  )
}
