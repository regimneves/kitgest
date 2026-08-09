import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, parseMoeda, formatarCompetencia } from '../lib/format'
import { montarPixBRCode } from '../lib/pix'
import { gerarQRDataURL, gerarReciboPDF } from '../lib/recibo'
import Modal from '../components/Modal'

const STATUS = {
  pendente: { label: 'Pendente', cor: '#eab308' },
  parcial:  { label: 'Parcial',  cor: '#f97316' },
  pago:     { label: 'Pago',     cor: '#22c55e' },
  atrasado: { label: 'Atrasado', cor: '#ef4444' }
}
const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', transferencia: 'Transferência', cartao: 'Cartão', outro: 'Outro' }

// mês atual como "AAAA-MM"
function mesAtual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
// "AAAA-MM" (input month) → "AAAA-MM-01" (date da competência)
const paraData = (mes) => (mes ? `${mes.slice(0, 7)}-01` : null)
const paraMes = (data) => (data ? String(data).slice(0, 7) : mesAtual())

const vazio = () => ({
  contrato_id: '', competencia: mesAtual(), valor: '',
  forma: 'pix', status: 'pago', observacoes: ''
})

export default function Recebimentos() {
  const { org } = useOrg()
  const [recebimentos, setRecebimentos] = useState([])
  const [contratos, setContratos] = useState([]) // vigentes p/ o dropdown
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(null)
  const [erro, setErro] = useState('')
  const [pix, setPix] = useState(null) // { rec, brcode, qr } modal

  const pixConfigurado = !!org?.pix_chave

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [{ data: rs, error }, { data: cs }] = await Promise.all([
      supabase.from('recebimentos')
        .select('*, inquilinos(nome, telefone, cpf), quartos(identificacao, casas(nome))')
        .order('competencia', { ascending: false })
        .order('criado_em', { ascending: false }),
      supabase.from('contratos')
        .select('id, valor_aluguel, status, inquilino_id, quarto_id, inquilinos(nome), quartos(identificacao, casas(nome))')
        .in('status', ['ativo', 'inadimplente', 'pendente'])
    ])
    if (error) setErro(error.message)
    setRecebimentos(rs || [])
    setContratos(cs || [])
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function abrirNovo() {
    setErro('')
    const ini = vazio()
    // se só houver 1 contrato, já seleciona e puxa o valor
    if (contratos.length === 1) {
      ini.contrato_id = contratos[0].id
      ini.valor = contratos[0].valor_aluguel
    }
    setEditando(ini)
  }
  function abrirEdicao(r) {
    setErro('')
    setEditando({
      ...r,
      competencia: paraMes(r.competencia),
      valor: r.valor ?? '',
      forma: r.forma || 'pix',
      observacoes: r.observacoes || ''
    })
  }

  function escolherContrato(contrato_id) {
    const c = contratos.find(x => x.id === contrato_id)
    setEditando(ed => ({
      ...ed,
      contrato_id,
      valor: (!ed.id && (ed.valor === '' || ed.valor == null) && c) ? c.valor_aluguel : ed.valor
    }))
  }

  // Reserva um nº de recibo atômico (RPC). Só p/ recebimento pago.
  async function proximoRecibo() {
    const { data, error } = await supabase.rpc('proximo_recibo', { p_org: org.id })
    if (error) throw error
    return data
  }

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    if (!editando.contrato_id) { setErro('Escolha o contrato.'); return }
    const contrato = contratos.find(c => c.id === editando.contrato_id)
      || { inquilino_id: editando.inquilino_id, quarto_id: editando.quarto_id }

    const payload = {
      org_id: org.id,
      contrato_id: editando.contrato_id,
      inquilino_id: contrato.inquilino_id,
      quarto_id: contrato.quarto_id,
      competencia: paraData(editando.competencia),
      valor: parseMoeda(editando.valor),
      forma: editando.forma || null,
      status: editando.status,
      observacoes: editando.observacoes?.trim() || null
    }

    try {
      const jaPago = editando.status === 'pago'
      const tinhaRecibo = editando.recibo_numero != null
      if (jaPago) {
        payload.pago_em = editando.pago_em || new Date().toISOString()
        payload.recibo_numero = tinhaRecibo ? editando.recibo_numero : await proximoRecibo()
      }

      const q = editando.id
        ? supabase.from('recebimentos').update(payload).eq('id', editando.id)
        : supabase.from('recebimentos').insert(payload)
      const { error } = await q
      if (error) throw error
      setEditando(null)
      carregar()
    } catch (err) {
      setErro(err.message)
    }
  }

  // Marca um pendente como pago e reserva o nº do recibo.
  async function marcarPago(r) {
    setErro('')
    try {
      const patch = { status: 'pago', pago_em: new Date().toISOString() }
      if (r.recibo_numero == null) patch.recibo_numero = await proximoRecibo()
      const { error } = await supabase.from('recebimentos').update(patch).eq('id', r.id)
      if (error) throw error
      carregar()
    } catch (err) { setErro(err.message) }
  }

  async function excluir(r) {
    if (!window.confirm(`Excluir o recebimento de ${formatarCompetencia(r.competencia)}?`)) return
    const { error } = await supabase.from('recebimentos').delete().eq('id', r.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  function brCodeDo(r) {
    return montarPixBRCode({
      chave: org.pix_chave, nome: org.pix_nome_recebedor || org.nome,
      cidade: org.pix_cidade, valor: Number(r.valor),
      txid: r.recibo_numero != null ? `REC${String(r.recibo_numero).padStart(4, '0')}` : 'KITGEST'
    })
  }

  async function abrirPix(r) {
    setErro('')
    try {
      const brcode = brCodeDo(r)
      const qr = await gerarQRDataURL(brcode, 240)
      setPix({ rec: r, brcode, qr })
    } catch (err) { setErro(err.message) }
  }

  async function baixarRecibo(r) {
    setErro('')
    try {
      const casa = r.quartos?.casas || null
      const brcode = pixConfigurado ? brCodeDo(r) : null
      await gerarReciboPDF({
        org,
        recebimento: r,
        inquilino: r.inquilinos || {},
        quarto: r.quartos || {},
        casa,
        pixBRCode: brcode
      })
    } catch (err) { setErro(err.message) }
  }

  function whatsappCobranca(r) {
    const tel = r.inquilinos?.telefone
    const d = String(tel || '').replace(/\D/g, '')
    if (d.length < 10) { window.alert('Inquilino sem telefone cadastrado.'); return }
    const ddi = d.startsWith('55') ? d : `55${d}`
    const nome = (r.inquilinos?.nome || '').split(' ')[0]
    const linhas = [
      `Olá ${nome}! Sobre o aluguel de ${formatarCompetencia(r.competencia)} (${formatarMoeda(r.valor)}).`
    ]
    if (pixConfigurado) linhas.push('', 'PIX copia e cola:', brCodeDo(r))
    const msg = encodeURIComponent(linhas.join('\n'))
    window.open(`https://wa.me/${ddi}?text=${msg}`, '_blank')
  }

  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); window.alert('PIX copiado!') }
    catch { window.prompt('Copie o código PIX:', texto) }
  }

  // Resumo do mês atual
  const resumo = useMemo(() => {
    const mes = paraData(mesAtual())
    let recebido = 0, pendentes = 0
    for (const r of recebimentos) {
      if (r.status === 'pago') { if (String(r.competencia) === mes) recebido += Number(r.valor || 0) }
      else pendentes++
    }
    return { recebido, pendentes }
  }, [recebimentos])

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Recebimentos</h1>
          <p className="sub" style={{ margin: 0 }}>
            Recebido em {formatarCompetencia(paraData(mesAtual()))}: <b>{formatarMoeda(resumo.recebido)}</b>
            {resumo.pendentes > 0 && <> · {resumo.pendentes} pendente(s)</>}
          </p>
        </div>
        <button className="ouro" onClick={abrirNovo} disabled={contratos.length === 0}>+ Registrar</button>
      </div>

      {!pixConfigurado && (
        <div className="card mt" style={{ borderColor: 'var(--cor-ouro)' }}>
          <strong>PIX não configurado</strong>
          <p className="sub" style={{ marginBottom: 0 }}>Cadastre sua chave PIX em Configuração para gerar QR e cobrança. O registro e o recibo funcionam mesmo sem PIX.</p>
        </div>
      )}
      {contratos.length === 0 && !carregando && (
        <div className="card mt" style={{ borderColor: 'var(--cor-ouro)' }}>
          <strong>Nenhum contrato vigente</strong>
          <p className="sub" style={{ marginBottom: 0 }}>Crie um contrato em <b>Contratos</b> para registrar recebimentos.</p>
        </div>
      )}

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : recebimentos.length === 0 ? (
        <div className="card mt">
          <strong>Nenhum recebimento ainda</strong>
          <p className="sub">Registre o primeiro pagamento de aluguel para emitir recibo.</p>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 10 }}>
          {recebimentos.map(r => {
            const s = STATUS[r.status] || STATUS.pendente
            const quartoTxt = r.quartos
              ? `${r.quartos.casas?.nome ? r.quartos.casas.nome + ' · ' : ''}${r.quartos.identificacao}`
              : '—'
            const pago = r.status === 'pago'
            return (
              <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{r.inquilinos?.nome || 'Inquilino'}</strong>
                    <span className="tag" style={{ background: s.cor + '22', color: s.cor, border: `1px solid ${s.cor}55` }}>{s.label}</span>
                    {r.recibo_numero != null && <span className="tag" style={{ background: 'var(--surface-2)' }}>recibo {String(r.recibo_numero).padStart(4, '0')}</span>}
                  </div>
                  <div className="sub" style={{ margin: '4px 0 0' }}>
                    {formatarCompetencia(r.competencia)} · {formatarMoeda(r.valor)} · {quartoTxt}
                    {r.forma ? ` · ${FORMAS[r.forma] || r.forma}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!pago && <button className="ouro" onClick={() => marcarPago(r)}>Receber</button>}
                  {pixConfigurado && <button className="secundario" onClick={() => abrirPix(r)} title="PIX QR / copia e cola">PIX</button>}
                  {pago && <button className="secundario" onClick={() => baixarRecibo(r)} title="Baixar recibo PDF">Recibo</button>}
                  <button className="secundario" onClick={() => whatsappCobranca(r)} title="Enviar no WhatsApp">💬</button>
                  <button className="secundario" onClick={() => abrirEdicao(r)}>Editar</button>
                  <button className="secundario" onClick={() => excluir(r)} title="Excluir">🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de registro */}
      {editando && (
        <Modal titulo={editando.id ? 'Editar recebimento' : 'Registrar recebimento'} onFechar={() => setEditando(null)}>
          <form onSubmit={salvar}>
            <label>Contrato *</label>
            <select value={editando.contrato_id} onChange={e => escolherContrato(e.target.value)}
                    disabled={!!editando.id}>
              <option value="">— escolher —</option>
              {contratos.map(c => {
                const casa = c.quartos?.casas?.nome ? `${c.quartos.casas.nome} · ` : ''
                return <option key={c.id} value={c.id}>{c.inquilinos?.nome} — {casa}{c.quartos?.identificacao}</option>
              })}
            </select>

            <div className="linha">
              <div>
                <label>Competência (mês)</label>
                <input type="month" value={editando.competencia}
                       onChange={e => setEditando({ ...editando, competencia: e.target.value })} />
              </div>
              <div>
                <label>Valor (R$)</label>
                <input inputMode="decimal" value={editando.valor}
                       onChange={e => setEditando({ ...editando, valor: e.target.value })}
                       placeholder="0,00" />
              </div>
            </div>

            <div className="linha">
              <div>
                <label>Forma</label>
                <select value={editando.forma} onChange={e => setEditando({ ...editando, forma: e.target.value })}>
                  {Object.entries(FORMAS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </div>
              <div>
                <label>Status</label>
                <select value={editando.status} onChange={e => setEditando({ ...editando, status: e.target.value })}>
                  {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <p className="sub" style={{ marginTop: 6 }}>Ao salvar como <b>Pago</b>, o sistema reserva o número do recibo automaticamente.</p>

            <label>Observações</label>
            <textarea rows={2} value={editando.observacoes || ''}
                      onChange={e => setEditando({ ...editando, observacoes: e.target.value })} />

            {erro && <div className="erro">{erro}</div>}

            <div className="linha mt">
              <button type="button" className="secundario" onClick={() => setEditando(null)}>Cancelar</button>
              <button type="submit" className="ouro">Salvar</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal PIX */}
      {pix && (
        <Modal titulo="Cobrança PIX" onFechar={() => setPix(null)}>
          <div style={{ textAlign: 'center' }}>
            <img src={pix.qr} alt="QR PIX" style={{ width: 220, height: 220, maxWidth: '100%' }} />
            <p className="sub" style={{ margin: '6px 0' }}>
              {formatarMoeda(pix.rec.valor)} · {pix.rec.inquilinos?.nome}
            </p>
          </div>
          <label>PIX copia e cola</label>
          <textarea readOnly rows={3} value={pix.brcode} onFocus={e => e.target.select()}
                    style={{ fontFamily: 'monospace', fontSize: '.8rem' }} />
          <div className="linha mt" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="secundario" onClick={() => copiar(pix.brcode)}>Copiar código</button>
            <button type="button" className="secundario" onClick={() => whatsappCobranca(pix.rec)}>💬 Enviar</button>
            <button type="button" className="ouro" onClick={() => setPix(null)}>Fechar</button>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>
            QR estático não confirma o pagamento automaticamente — confirme pelo comprovante e marque como <b>Pago</b>.
          </p>
        </Modal>
      )}
    </div>
  )
}
