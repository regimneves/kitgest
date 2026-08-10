import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, formatarData, formatarCompetencia } from '../lib/format'
import { montarPixBRCode } from '../lib/pix'
import { lerConfig, mesAtual, competenciaISO, vencimentoNaCompetencia, diasAte, TEMPLATE_PADRAO } from '../lib/gestao'

const VIGENTE = ['ativo', 'inadimplente', 'pendente']

function aplicar(tpl, d) {
  return String(tpl).replace(/{(\w+)}/g, (_, k) => (d[k] ?? ''))
}

export default function Avisos() {
  const { org } = useOrg()
  const cfg = useMemo(() => lerConfig(org), [org])
  const marcos = useMemo(() => [...(cfg.avisos.dias || [])].map(Number).sort((a, b) => b - a), [cfg])
  const maxMarco = marcos.length ? marcos[0] : 7
  const template = cfg.avisos.template || TEMPLATE_PADRAO
  const pixOk = !!org?.pix_chave

  const [contratos, setContratos] = useState([])
  const [pagos, setPagos] = useState(new Set())
  const [enviados, setEnviados] = useState(new Set()) // `${contrato}|${marco}`
  const [competencia, setCompetencia] = useState(mesAtual())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const comp = competenciaISO(competencia)
    const [{ data: cs, error }, { data: rs }, { data: es }] = await Promise.all([
      supabase.from('contratos')
        .select('id, dia_vencimento, valor_aluguel, desconto_pontualidade, status, inquilinos(nome, telefone), quartos(identificacao, casas(nome))')
        .in('status', VIGENTE),
      supabase.from('recebimentos').select('contrato_id, status').eq('competencia', comp),
      supabase.from('avisos_enviados').select('contrato_id, marco').eq('competencia', comp)
    ])
    if (error) setErro(error.message)
    setContratos(cs || [])
    const p = new Set(); for (const r of rs || []) if (r.status === 'pago') p.add(r.contrato_id)
    setPagos(p)
    setEnviados(new Set((es || []).map(e => `${e.contrato_id}|${e.marco}`)))
    setCarregando(false)
  }, [competencia])

  useEffect(() => { carregar() }, [carregar])

  // Contratos com vencimento chegando a um marco (não pagos, não vencidos).
  const itens = useMemo(() => {
    return contratos
      .filter(c => !pagos.has(c.id) && c.dia_vencimento)
      .map(c => {
        const venc = vencimentoNaCompetencia(c.dia_vencimento, competencia)
        const dias = diasAte(venc)
        // marco casado = menor marco >= dias (o mais apertado já alcançado)
        let marco = null
        for (const m of [...marcos].sort((a, b) => a - b)) { if (dias <= m) { marco = m; break } }
        return { c, venc, dias, marco }
      })
      .filter(x => x.dias >= 0 && x.marco != null)   // só a vencer, dentro da janela dos marcos
      .sort((a, b) => a.dias - b.dias)
  }, [contratos, pagos, competencia, marcos])

  function mensagem(it) {
    const nome = (it.c.inquilinos?.nome || '').split(' ')[0]
    const q = it.c.quartos
    const quarto = q ? `${q.casas?.nome ? q.casas.nome + ' ' : ''}${q.identificacao}` : 'seu quarto'
    const quando = it.dias === 0 ? 'hoje' : it.dias === 1 ? 'amanhã' : `em ${it.dias} dias`
    let pix = ''
    if (pixOk) {
      const brcode = montarPixBRCode({
        chave: org.pix_chave, nome: org.pix_nome_recebedor || org.nome, cidade: org.pix_cidade,
        valor: Number(it.c.valor_aluguel || 0), txid: 'ALUG' + competencia.replace('-', '')
      })
      pix = `\n\nPIX copia e cola:\n${brcode}`
    }
    const desc = Number(it.c.desconto_pontualidade || 0)
    const extra = desc > 0 ? ` Pagando até o vencimento, você tem ${formatarMoeda(desc)} de desconto.` : ''
    return aplicar(template, {
      nome, quarto, valor: formatarMoeda(it.c.valor_aluguel),
      vencimento: formatarData(it.venc.toISOString()), quando,
      competencia: formatarCompetencia(competenciaISO(competencia)), pix
    }) + extra
  }

  async function avisar(it) {
    const tel = it.c.inquilinos?.telefone
    const d = String(tel || '').replace(/\D/g, '')
    if (d.length < 10) { window.alert('Inquilino sem telefone. Cadastre em Inquilinos.'); return }
    const ddi = d.startsWith('55') ? d : `55${d}`
    window.open(`https://wa.me/${ddi}?text=${encodeURIComponent(mensagem(it))}`, '_blank')
    // registra o envio (cross-device)
    await supabase.from('avisos_enviados').upsert(
      { org_id: org.id, contrato_id: it.c.id, competencia: competenciaISO(competencia), marco: it.marco },
      { onConflict: 'contrato_id,competencia,marco' }
    )
    setEnviados(prev => new Set(prev).add(`${it.c.id}|${it.marco}`))
  }

  const TAG = (dias) => dias === 0
    ? { t: 'Vence hoje', cor: '#f97316' }
    : dias <= 2 ? { t: `Vence em ${dias}d`, cor: '#eab308' } : { t: `Vence em ${dias}d`, cor: '#3b82f6' }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h1>Avisos de vencimento</h1>
          <p className="sub" style={{ margin: 0 }}>Lembretes antes do vencimento nos marcos {marcos.map(m => m === 0 ? 'no dia' : `${m}d`).join(' · ')}. Ajuste em Configuração.</p>
        </div>
        <div>
          <label style={{ fontSize: '.8rem' }}>Competência</label>
          <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} />
        </div>
      </div>

      {cfg.avisos.ativo === false && (
        <div className="card mt" style={{ borderColor: 'var(--cor-ouro)' }}>
          <strong>Avisos desativados</strong>
          <p className="sub" style={{ marginBottom: 0 }}>Ative os avisos de vencimento em Configuração.</p>
        </div>
      )}
      {!pixOk && (
        <div className="card mt" style={{ borderColor: 'var(--cor-ouro)' }}>
          <strong>Dica</strong>
          <p className="sub" style={{ marginBottom: 0 }}>Cadastre sua chave PIX em Configuração para incluir o “copia e cola” nas mensagens.</p>
        </div>
      )}

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : itens.length === 0 ? (
        <div className="card mt">
          <strong>Nenhum vencimento chegando 🎉</strong>
          <p className="sub" style={{ marginBottom: 0 }}>Nenhum aluguel a vencer nos próximos {maxMarco} dias em {formatarCompetencia(competenciaISO(competencia))} (os já pagos e os atrasados não aparecem aqui).</p>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 10 }}>
          {itens.map(it => {
            const tag = TAG(it.dias)
            const q = it.c.quartos
            const local = q ? `${q.casas?.nome ? q.casas.nome + ' · ' : ''}${q.identificacao}` : '—'
            const jaEnviado = enviados.has(`${it.c.id}|${it.marco}`)
            return (
              <div key={it.c.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderLeft: `4px solid ${tag.cor}` }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{it.c.inquilinos?.nome || 'Inquilino'}</strong>
                    <span className="tag" style={{ background: tag.cor + '22', color: tag.cor, border: `1px solid ${tag.cor}55` }}>{tag.t}</span>
                    {jaEnviado && <span className="tag" style={{ background: 'var(--surface-2)' }}>✓ avisado</span>}
                  </div>
                  <div className="sub" style={{ margin: '4px 0 0' }}>
                    {local} · {formatarMoeda(it.c.valor_aluguel)} · vence {formatarData(it.venc.toISOString())}
                  </div>
                </div>
                <button className={jaEnviado ? 'secundario' : 'ouro'} onClick={() => avisar(it)}>💬 {jaEnviado ? 'Avisar de novo' : 'Avisar'}</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
