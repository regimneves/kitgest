import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { lerConfig, TEMPLATE_PADRAO } from '../lib/gestao'

// Configuração da operação: branding (nome, cor, logo) + PIX + gestão (avisos/alertas).
// Grava na tabela orgs; logo vai pro bucket `logos/<org_id>/logo.<ext>`.
export default function Config() {
  const { org, recarregar } = useOrg()
  const cfg = lerConfig(org)
  const [form, setForm] = useState({
    nome: org.nome || '',
    cor_primaria: org.cor_primaria || '#1e293b',
    telefone: org.telefone || '',
    pix_tipo: org.pix_tipo || 'celular',
    pix_chave: org.pix_chave || '',
    pix_nome_recebedor: org.pix_nome_recebedor || '',
    pix_cidade: org.pix_cidade || ''
  })
  // Gestão: avisos de vencimento + limiares dos alertas.
  const [gestao, setGestao] = useState({
    avisos_ativo: cfg.avisos.ativo !== false,
    avisos_dias: (cfg.avisos.dias || [7, 2, 0]).join(', '),
    avisos_template: cfg.avisos.template || '',
    alerta_contrato: cfg.alertas.contrato_vencendo_dias,
    alerta_vaga: cfg.alertas.vaga_dias,
    alerta_manut: cfg.alertas.manutencao_parada_dias
  })
  const [logoBusy, setLogoBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setG = (k) => (e) => setGestao(g => ({ ...g, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  function montarGestaoConfig() {
    const dias = [...new Set(
      String(gestao.avisos_dias).split(/[\s,]+/).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n >= 0)
    )].sort((a, b) => b - a)
    return {
      avisos: {
        ativo: !!gestao.avisos_ativo,
        dias: dias.length ? dias : [7, 2, 0],
        ...(gestao.avisos_template?.trim() ? { template: gestao.avisos_template.trim() } : {})
      },
      alertas: {
        contrato_vencendo_dias: Math.max(1, parseInt(gestao.alerta_contrato, 10) || 30),
        vaga_dias: Math.max(1, parseInt(gestao.alerta_vaga, 10) || 15),
        manutencao_parada_dias: Math.max(1, parseInt(gestao.alerta_manut, 10) || 7)
      }
    }
  }

  async function salvar(e) {
    e.preventDefault()
    setErro(''); setOk(''); setBusy(true)
    const { error } = await supabase.from('orgs')
      .update({ ...form, gestao_config: montarGestaoConfig() }).eq('id', org.id)
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

      <div className="card mt">
        <strong>Avisos de vencimento</strong>
        <p className="sub" style={{ marginTop: 4 }}>Lembretes enviados ao inquilino antes do vencimento do aluguel (tela “Avisos”).</p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={gestao.avisos_ativo} onChange={setG('avisos_ativo')} />
          Ativar avisos de vencimento
        </label>

        <label htmlFor="dias">Marcos (dias antes do vencimento)</label>
        <input id="dias" value={gestao.avisos_dias} onChange={setG('avisos_dias')} placeholder="7, 2, 0" />
        <p className="sub" style={{ marginTop: 4 }}>Use <b>0</b> para o dia do vencimento. Ex.: <b>7, 2, 0</b> avisa 7 dias antes, 2 dias antes e no dia.</p>

        <label htmlFor="tpl">Mensagem (opcional)</label>
        <textarea id="tpl" rows={4} value={gestao.avisos_template} onChange={setG('avisos_template')}
                  placeholder={TEMPLATE_PADRAO} />
        <p className="sub" style={{ marginTop: 4 }}>
          Deixe em branco para usar o texto padrão. Campos: {'{nome} {quarto} {valor} {vencimento} {quando} {competencia} {pix}'}
        </p>
      </div>

      <div className="card mt">
        <strong>Alertas de gestão</strong>
        <p className="sub" style={{ marginTop: 4 }}>Quando destacar cada situação na tela “Alertas”.</p>
        <div className="linha">
          <div>
            <label htmlFor="ac">Contrato vencendo (dias)</label>
            <input id="ac" inputMode="numeric" value={gestao.alerta_contrato} onChange={setG('alerta_contrato')} />
          </div>
          <div>
            <label htmlFor="av">Quarto vago (dias)</label>
            <input id="av" inputMode="numeric" value={gestao.alerta_vaga} onChange={setG('alerta_vaga')} />
          </div>
          <div>
            <label htmlFor="am">Manutenção parada (dias)</label>
            <input id="am" inputMode="numeric" value={gestao.alerta_manut} onChange={setG('alerta_manut')} />
          </div>
        </div>
      </div>

      {erro && <div className="erro">{erro}</div>}
      {ok && <div className="ok">{ok}</div>}

      <button className="ouro mt" type="submit" disabled={busy} style={{ width: '100%' }}>
        {busy ? 'Salvando…' : 'Salvar configuração'}
      </button>
    </form>
  )
}
