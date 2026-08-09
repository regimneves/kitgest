import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, formatarCompetencia, formatarData } from '../lib/format'
import { montarPixBRCode } from '../lib/pix'

const VIGENTE = ['ativo', 'inadimplente', 'pendente']
const mesAtual = () => new Date().toISOString().slice(0, 7)
const hoje0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

// Chave local p/ lembrar o que já foi cobrado (device-local, 1 operador).
const LOG_KEY = 'kitgest_cobranca_log'
function lerLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '{}') } catch { return {} } }
function gravarLog(l) { try { localStorage.setItem(LOG_KEY, JSON.stringify(l)) } catch { /* ignore */ } }

export default function Cobranca() {
  const { org } = useOrg()
  const [contratos, setContratos] = useState([])
  const [pagos, setPagos] = useState(new Set())
  const [competencia, setCompetencia] = useState(mesAtual())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [log, setLog] = useState(lerLog())

  const pixOk = !!org?.pix_chave

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data: cs, error } = await supabase.from('contratos')
      .select('id, dia_vencimento, valor_aluguel, multa_percentual, juros_dia_percentual, desconto_pontualidade, status, inquilinos(nome, telefone), quartos(identificacao, casas(nome))')
      .in('status', VIGENTE)
    if (error) setErro(error.message)
    setContratos(cs || [])
    setCarregando(false)
  }, [])

  const carregarPagos = useCallback(async () => {
    const { data } = await supabase.from('recebimentos')
      .select('contrato_id, status').eq('competencia', `${competencia}-01`)
    const s = new Set()
    for (const r of data || []) if (r.status === 'pago') s.add(r.contrato_id)
    setPagos(s)
  }, [competencia])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { carregarPagos() }, [carregarPagos])

  // Calcula estágio + encargos de cada contrato em aberto na competência.
  const itens = useMemo(() => {
    const [ano, mes] = competencia.split('-').map(Number)
    const ultimoDia = new Date(ano, mes, 0).getDate()
    const hoje = hoje0()

    return contratos
      .filter(c => !pagos.has(c.id))
      .map(c => {
        const valor = Number(c.valor_aluguel || 0)
        let vencimento = null, dias = null
        if (c.dia_vencimento) {
          const dia = Math.min(c.dia_vencimento, ultimoDia)
          vencimento = new Date(ano, mes - 1, dia)
          dias = Math.round((vencimento - hoje) / 86400000) // >0 futuro, 0 hoje, <0 atrasado
        }
        const atrasado = dias != null && dias < 0
        const diasAtraso = atrasado ? -dias : 0
        const multa = atrasado ? valor * (Number(c.multa_percentual || 0) / 100) : 0
        const juros = atrasado ? valor * (Number(c.juros_dia_percentual || 0) / 100) * diasAtraso : 0
        const total = valor + multa + juros
        let estagio = 'sem_data'
        if (dias != null) {
          if (dias < 0) estagio = 'atrasado'
          else if (dias === 0) estagio = 'hoje'
          else if (dias <= 5) estagio = 'em_breve'
          else estagio = 'a_vencer'
        }
        return { c, valor, vencimento, dias, atrasado, diasAtraso, multa, juros, total, estagio }
      })
      // ordena por urgência: mais atrasado primeiro
      .sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999))
  }, [contratos, pagos, competencia])

  const resumo = useMemo(() => {
    const r = { atrasado: 0, atrasadoV: 0, aVencer: 0, aVencerV: 0 }
    for (const it of itens) {
      if (it.estagio === 'atrasado') { r.atrasado++; r.atrasadoV += it.total }
      else { r.aVencer++; r.aVencerV += it.valor }
    }
    return r
  }, [itens])

  function brcode(it) {
    return montarPixBRCode({
      chave: org.pix_chave, nome: org.pix_nome_recebedor || org.nome, cidade: org.pix_cidade,
      valor: it.atrasado ? it.total : it.valor,
      txid: 'ALUG' + competencia.replace('-', '')
    })
  }

  function mensagem(it) {
    const nome = (it.c.inquilinos?.nome || '').split(' ')[0]
    const q = it.c.quartos
    const quarto = q ? `${q.casas?.nome ? q.casas.nome + ' ' : ''}${q.identificacao}` : 'seu quarto'
    const comp = formatarCompetencia(`${competencia}-01`)
    const L = []
    if (it.estagio === 'atrasado') {
      L.push(`Olá ${nome}! Passando sobre o aluguel do ${quarto} (${comp}), que venceu em ${formatarData(it.vencimento.toISOString())} e consta em aberto.`)
      if (it.multa > 0 || it.juros > 0) {
        L.push(`Valor ${formatarMoeda(it.valor)}` +
          (it.multa > 0 ? ` + multa ${formatarMoeda(it.multa)}` : '') +
          (it.juros > 0 ? ` + juros ${formatarMoeda(it.juros)} (${it.diasAtraso} dia(s))` : '') +
          ` = total ${formatarMoeda(it.total)}.`)
      } else {
        L.push(`Valor ${formatarMoeda(it.valor)}.`)
      }
      L.push('Se já efetuou o pagamento, por favor me envie o comprovante e desconsidere. Obrigado!')
    } else if (it.estagio === 'hoje') {
      L.push(`Olá ${nome}! Lembrete: o aluguel do ${quarto} (${comp}), no valor de ${formatarMoeda(it.valor)}, vence hoje.`)
    } else {
      const quando = it.dias === 1 ? 'amanhã' : `em ${it.dias} dias`
      L.push(`Olá ${nome}! Passando pra lembrar do aluguel do ${quarto} (${comp}), ${formatarMoeda(it.valor)}, que vence ${quando}${it.vencimento ? ` (dia ${it.vencimento.getDate()})` : ''}.`)
      const desc = Number(it.c.desconto_pontualidade || 0)
      if (desc > 0) L.push(`Pagando até o vencimento, você tem ${formatarMoeda(desc)} de desconto.`)
    }
    if (pixOk) L.push('', 'PIX copia e cola:', brcode(it))
    L.push('', 'Qualquer dúvida, estou à disposição!')
    return L.join('\n')
  }

  function cobrar(it) {
    const tel = it.c.inquilinos?.telefone
    const d = String(tel || '').replace(/\D/g, '')
    if (d.length < 10) { window.alert('Inquilino sem telefone cadastrado. Adicione em Inquilinos.'); return }
    const ddi = d.startsWith('55') ? d : `55${d}`
    window.open(`https://wa.me/${ddi}?text=${encodeURIComponent(mensagem(it))}`, '_blank')
    // marca como cobrado (device-local)
    const novo = { ...log, [`${it.c.id}|${competencia}`]: new Date().toISOString() }
    setLog(novo); gravarLog(novo)
  }

  const TAG = {
    atrasado: { t: 'Atrasado', cor: '#ef4444' },
    hoje: { t: 'Vence hoje', cor: '#f97316' },
    em_breve: { t: 'Vence em breve', cor: '#eab308' },
    a_vencer: { t: 'A vencer', cor: '#3b82f6' },
    sem_data: { t: 'Sem vencimento', cor: '#94a3b8' }
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h1>Cobrança</h1>
          <p className="sub" style={{ margin: 0 }}>Quem deve na competência, com mensagem pronta pro WhatsApp.</p>
        </div>
        <div>
          <label style={{ fontSize: '.8rem' }}>Competência</label>
          <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} />
        </div>
      </div>

      {!pixOk && (
        <div className="card mt" style={{ borderColor: 'var(--cor-ouro)' }}>
          <strong>Dica</strong>
          <p className="sub" style={{ marginBottom: 0 }}>Cadastre sua chave PIX em Configuração para incluir o “copia e cola” automático nas mensagens.</p>
        </div>
      )}

      {/* Resumo */}
      <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="sub" style={{ fontSize: '.78rem' }}>Atrasados</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: resumo.atrasado ? '#ef4444' : 'inherit' }}>{resumo.atrasado}</div>
          <div className="sub" style={{ fontSize: '.72rem' }}>{formatarMoeda(resumo.atrasadoV)} em aberto</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="sub" style={{ fontSize: '.78rem' }}>A vencer</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{resumo.aVencer}</div>
          <div className="sub" style={{ fontSize: '.72rem' }}>{formatarMoeda(resumo.aVencerV)}</div>
        </div>
      </div>

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : itens.length === 0 ? (
        <div className="card mt">
          <strong>Tudo em dia 🎉</strong>
          <p className="sub" style={{ marginBottom: 0 }}>Nenhum contrato vigente em aberto para {formatarCompetencia(`${competencia}-01`)}.</p>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 10 }}>
          {itens.map(it => {
            const tag = TAG[it.estagio]
            const q = it.c.quartos
            const local = q ? `${q.casas?.nome ? q.casas.nome + ' · ' : ''}${q.identificacao}` : '—'
            const cobradoEm = log[`${it.c.id}|${competencia}`]
            return (
              <div key={it.c.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderLeft: `4px solid ${tag.cor}` }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{it.c.inquilinos?.nome || 'Inquilino'}</strong>
                    <span className="tag" style={{ background: tag.cor + '22', color: tag.cor, border: `1px solid ${tag.cor}55` }}>
                      {tag.t}{it.estagio === 'atrasado' ? ` ${it.diasAtraso}d` : (it.dias > 0 ? ` · ${it.dias}d` : '')}
                    </span>
                    {cobradoEm && <span className="tag" style={{ background: 'var(--surface-2)' }}>cobrado {formatarData(cobradoEm)}</span>}
                  </div>
                  <div className="sub" style={{ margin: '4px 0 0' }}>
                    {local} · {formatarMoeda(it.valor)}
                    {it.atrasado && it.total > it.valor ? ` → total ${formatarMoeda(it.total)}` : ''}
                    {it.vencimento ? ` · vence ${formatarData(it.vencimento.toISOString())}` : ' · sem dia de vencimento'}
                  </div>
                </div>
                <button className="ouro" onClick={() => cobrar(it)}>💬 Cobrar</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
