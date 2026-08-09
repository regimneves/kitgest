import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'

// Configuração da operação: branding (nome, cor, logo) + PIX.
// Grava na tabela orgs; logo vai pro bucket `logos/<org_id>/logo.<ext>`.
export default function Config() {
  const { org, recarregar } = useOrg()
  const [form, setForm] = useState({
    nome: org.nome || '',
    cor_primaria: org.cor_primaria || '#1e293b',
    telefone: org.telefone || '',
    pix_tipo: org.pix_tipo || 'celular',
    pix_chave: org.pix_chave || '',
    pix_nome_recebedor: org.pix_nome_recebedor || '',
    pix_cidade: org.pix_cidade || ''
  })
  const [logoBusy, setLogoBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function salvar(e) {
    e.preventDefault()
    setErro(''); setOk(''); setBusy(true)
    const { error } = await supabase.from('orgs').update(form).eq('id', org.id)
    if (error) setErro(error.message)
    else { setOk('Configuração salva.'); await recarregar() }
    setBusy(false)
  }

  async function enviarLogo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setErro(''); setOk(''); setLogoBusy(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `${org.id}/logo.${ext}`
      const { error: upErr } = await supabase.storage
        .from('logos').upload(path, file, { upsert: true, cacheControl: '3600' })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('logos').getPublicUrl(path)
      const url = `${data.publicUrl}?v=${Date.now()}`  // cache-buster
      const { error: dbErr } = await supabase.from('orgs').update({ logo_url: url }).eq('id', org.id)
      if (dbErr) throw dbErr
      setOk('Logo atualizada.')
      await recarregar()
    } catch (err) {
      setErro(err.message || 'Falha ao enviar a logo.')
    } finally {
      setLogoBusy(false)
    }
  }

  return (
    <form onSubmit={salvar} style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>Configuração</h1>
      <p className="sub">Identidade da operação e dados de recebimento (PIX).</p>

      <div className="card">
        <strong>Identidade</strong>

        <label htmlFor="nome">Nome da operação</label>
        <input id="nome" value={form.nome} onChange={set('nome')} placeholder="Ex.: Kitnets da Regiane" />

        <div className="linha">
          <div>
            <label htmlFor="cor">Cor do sistema</label>
            <input id="cor" type="color" value={form.cor_primaria} onChange={set('cor_primaria')}
                   style={{ height: 44, padding: 4 }} />
          </div>
          <div>
            <label htmlFor="tel">Telefone</label>
            <input id="tel" value={form.telefone} onChange={set('telefone')} placeholder="(00) 00000-0000" />
          </div>
        </div>

        <label>Logo</label>
        <div className="linha" style={{ alignItems: 'center' }}>
          {org.logo_url
            ? <img src={org.logo_url} alt="logo" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', flex: '0 0 auto' }} />
            : <div style={{ width: 56, height: 56, borderRadius: 10, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', color: 'var(--cor-ouro)', fontWeight: 700, flex: '0 0 auto' }}>KG</div>}
          <input type="file" accept="image/*" onChange={enviarLogo} disabled={logoBusy} />
        </div>
      </div>

      <div className="card mt">
        <strong>Recebimento (PIX)</strong>

        <div className="linha">
          <div>
            <label htmlFor="pixtipo">Tipo de chave</label>
            <select id="pixtipo" value={form.pix_tipo} onChange={set('pix_tipo')}>
              <option value="celular">Celular</option>
              <option value="cpf">CPF</option>
              <option value="cnpj">CNPJ</option>
              <option value="email">E-mail</option>
              <option value="aleatoria">Aleatória</option>
            </select>
          </div>
          <div>
            <label htmlFor="pixchave">Chave PIX</label>
            <input id="pixchave" value={form.pix_chave} onChange={set('pix_chave')} />
          </div>
        </div>

        <label htmlFor="pixnome">Nome do recebedor</label>
        <input id="pixnome" value={form.pix_nome_recebedor} onChange={set('pix_nome_recebedor')} maxLength={25} />

        <label htmlFor="pixcidade">Cidade do recebedor</label>
        <input id="pixcidade" value={form.pix_cidade} onChange={set('pix_cidade')} maxLength={15} />
      </div>

      {erro && <div className="erro">{erro}</div>}
      {ok && <div className="ok">{ok}</div>}

      <button className="ouro mt" type="submit" disabled={busy} style={{ width: '100%' }}>
        {busy ? 'Salvando…' : 'Salvar configuração'}
      </button>
    </form>
  )
}
