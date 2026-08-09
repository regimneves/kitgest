import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, parseMoeda } from '../lib/format'
import Modal from '../components/Modal'

const STATUS = {
  ativo:        { label: 'Ativo',        cor: '#22c55e' },
  pendente:     { label: 'Pendente',     cor: '#eab308' },
  inadimplente: { label: 'Inadimplente', cor: '#ef4444' },
  encerrado:    { label: 'Encerrado',    cor: '#94a3b8' }
}

const vazio = {
  inquilino_id: '', quarto_id: '', periodicidade: 'mensal',
  dia_vencimento: '', valor_aluguel: '', caucao_valor: '',
  multa_percentual: '', juros_dia_percentual: '', desconto_pontualidade: '',
  data_inicio: '', data_fim: '', status: 'ativo', observacoes: ''
}

// Só considera o quarto "ocupado" por contratos vigentes.
const VIGENTE = new Set(['ativo', 'inadimplente', 'pendente'])

export default function Contratos() {
  const { org } = useOrg()
  const [contratos, setContratos] = useState([])
  const [inquilinos, setInquilinos] = useState([])
  const [quartos, setQuartos] = useState([]) // com casas(nome)
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(null)
  const [filtro, setFiltro] = useState('vigentes') // vigentes | todos
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [{ data: cs, error }, { data: is }, { data: qs }] = await Promise.all([
      supabase.from('contratos')
        .select('*, inquilinos(nome, telefone), quartos(identificacao, casas(nome))')
        .order('criado_em', { ascending: false }),
      supabase.from('inquilinos').select('id, nome').order('nome'),
      supabase.from('quartos').select('id, identificacao, valor_final, casa_id, casas(nome)').order('identificacao')
    ])
    if (error) setErro(error.message)
    setContratos(cs || [])
    setInquilinos(is || [])
    setQuartos(qs || [])
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // Quartos já ocupados por um contrato vigente (não deixar dois ativos no mesmo quarto).
  const quartoOcupadoPor = useMemo(() => {
    const m = {}
    for (const c of contratos) {
      if (VIGENTE.has(c.status)) m[c.quarto_id] = c.id
    }
    return m
  }, [contratos])

  function abrirNovo() { setErro(''); setEditando({ ...vazio }) }
  function abrirEdicao(c) {
    setErro('')
    setEditando({
      ...vazio, ...c,
      dia_vencimento: c.dia_vencimento ?? '',
      valor_aluguel: c.valor_aluguel ?? '',
      caucao_valor: c.caucao_valor ?? '',
      multa_percentual: c.multa_percentual ?? '',
      juros_dia_percentual: c.juros_dia_percentual ?? '',
      desconto_pontualidade: c.desconto_pontualidade ?? '',
      data_inicio: c.data_inicio ?? '',
      data_fim: c.data_fim ?? ''
    })
  }

  // Ao escolher o quarto num contrato NOVO, sugere o valor final do quarto.
  function escolherQuarto(quarto_id) {
    const q = quartos.find(x => x.id === quarto_id)
    setEditando(ed => ({
      ...ed,
      quarto_id,
      valor_aluguel: (!ed.id && (ed.valor_aluguel === '' || ed.valor_aluguel == null) && q)
        ? q.valor_final : ed.valor_aluguel
    }))
  }

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    if (!editando.inquilino_id) { setErro('Escolha o inquilino.'); return }
    if (!editando.quarto_id) { setErro('Escolha o quarto.'); return }

    // trava: quarto já ocupado por OUTRO contrato vigente
    const donoAtual = quartoOcupadoPor[editando.quarto_id]
    if (VIGENTE.has(editando.status) && donoAtual && donoAtual !== editando.id) {
      setErro('Este quarto já tem um contrato vigente. Encerre-o antes de criar outro.')
      return
    }

    const dia = editando.dia_vencimento === '' ? null : Number(editando.dia_vencimento)
    if (dia !== null && (dia < 1 || dia > 31)) { setErro('Dia de vencimento deve ser entre 1 e 31.'); return }

    const payload = {
      org_id: org.id,
      inquilino_id: editando.inquilino_id,
      quarto_id: editando.quarto_id,
      periodicidade: editando.periodicidade || 'mensal',
      dia_vencimento: dia,
      valor_aluguel: parseMoeda(editando.valor_aluguel),
      caucao_valor: parseMoeda(editando.caucao_valor),
      multa_percentual: editando.multa_percentual === '' ? 0 : parseMoeda(editando.multa_percentual),
      juros_dia_percentual: editando.juros_dia_percentual === '' ? 0 : parseMoeda(editando.juros_dia_percentual),
      desconto_pontualidade: editando.desconto_pontualidade === '' ? 0 : parseMoeda(editando.desconto_pontualidade),
      data_inicio: editando.data_inicio || null,
      data_fim: editando.data_fim || null,
      status: editando.status,
      observacoes: editando.observacoes?.trim() || null
    }

    let contratoId = editando.id
    if (editando.id) {
      const { error } = await supabase.from('contratos').update(payload).eq('id', editando.id)
      if (error) { setErro(error.message); return }
    } else {
      const { data, error } = await supabase.from('contratos').insert(payload).select('id').single()
      if (error) { setErro(error.message); return }
      contratoId = data.id
    }

    // Sincroniza o status do quarto: vigente → ocupado; encerrado → vago.
    const novoStatusQuarto = VIGENTE.has(payload.status) ? 'ocupado' : 'vago'
    await supabase.from('quartos').update({ status: novoStatusQuarto }).eq('id', payload.quarto_id)

    setEditando(null)
    carregar()
  }

  async function excluir(c) {
    if (!window.confirm(`Excluir o contrato de ${c.inquilinos?.nome || 'inquilino'}? Os recebimentos ligados também serão apagados.`)) return
    const { error } = await supabase.from('contratos').delete().eq('id', c.id)
    if (error) { setErro(error.message); return }
    // libera o quarto
    await supabase.from('quartos').update({ status: 'vago' }).eq('id', c.quarto_id)
    carregar()
  }

  const lista = filtro === 'vigentes'
    ? contratos.filter(c => VIGENTE.has(c.status))
    : contratos

  const semInquilinos = inquilinos.length === 0
  const semQuartos = quartos.length === 0

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Contratos</h1>
          <p className="sub" style={{ margin: 0 }}>Vínculo inquilino × quarto, com valor, vencimento e caução.</p>
        </div>
        <button className="ouro" onClick={abrirNovo} disabled={semInquilinos || semQuartos}>+ Novo contrato</button>
      </div>

      {(semInquilinos || semQuartos) && (
        <div className="card mt" style={{ borderColor: 'var(--cor-ouro)' }}>
          <strong>Antes de criar um contrato</strong>
          <p className="sub" style={{ marginBottom: 0 }}>
            {semInquilinos && <>Cadastre ao menos um <b>inquilino</b>. </>}
            {semQuartos && <>Cadastre ao menos um <b>quarto</b> (em Casas).</>}
          </p>
        </div>
      )}

      {contratos.length > 0 && (
        <div className="mt" style={{ display: 'flex', gap: 8 }}>
          <button className={filtro === 'vigentes' ? 'ouro' : 'secundario'} onClick={() => setFiltro('vigentes')}>Vigentes</button>
          <button className={filtro === 'todos' ? 'ouro' : 'secundario'} onClick={() => setFiltro('todos')}>Todos</button>
        </div>
      )}

      {erro && <div className="erro">{erro}</div>}

      {carregando ? (
        <p className="sub mt">Carregando…</p>
      ) : contratos.length === 0 ? (
        <div className="card mt">
          <strong>Nenhum contrato ainda</strong>
          <p className="sub">Crie um contrato para começar a registrar recebimentos de aluguel.</p>
        </div>
      ) : (
        <div className="mt" style={{ display: 'grid', gap: 10 }}>
          {lista.map(c => {
            const s = STATUS[c.status] || STATUS.ativo
            const quartoTxt = c.quartos
              ? `${c.quartos.casas?.nome ? c.quartos.casas.nome + ' · ' : ''}${c.quartos.identificacao}`
              : '—'
            return (
              <div key={c.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{c.inquilinos?.nome || 'Inquilino'}</strong>
                    <span className="tag" style={{ background: s.cor + '22', color: s.cor, border: `1px solid ${s.cor}55` }}>
                      {s.label}
                    </span>
                  </div>
                  <div className="sub" style={{ margin: '4px 0 0' }}>
                    {quartoTxt} · {formatarMoeda(c.valor_aluguel)}/mês
                    {c.dia_vencimento ? ` · vence dia ${c.dia_vencimento}` : ''}
                  </div>
                  {Number(c.caucao_valor) > 0 && (
                    <div className="sub" style={{ margin: '2px 0 0' }}>caução {formatarMoeda(c.caucao_valor)}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="secundario" onClick={() => abrirEdicao(c)}>Editar</button>
                  <button className="secundario" onClick={() => excluir(c)} title="Excluir">🗑</button>
                </div>
              </div>
            )
          })}
          {lista.length === 0 && <p className="sub">Nenhum contrato vigente. Veja em “Todos”.</p>}
        </div>
      )}

      {editando && (
        <Modal titulo={editando.id ? 'Editar contrato' : 'Novo contrato'} onFechar={() => setEditando(null)}>
          <form onSubmit={salvar}>
            <label>Inquilino *</label>
            <select value={editando.inquilino_id}
                    onChange={e => setEditando({ ...editando, inquilino_id: e.target.value })}>
              <option value="">— escolher —</option>
              {inquilinos.map(i => <option key={i.id} value={i.id}>{i.nome}</option>)}
            </select>

            <label>Quarto *</label>
            <select value={editando.quarto_id}
                    onChange={e => escolherQuarto(e.target.value)}>
              <option value="">— escolher —</option>
              {quartos.map(q => {
                const ocupado = quartoOcupadoPor[q.id] && quartoOcupadoPor[q.id] !== editando.id
                const casa = q.casas?.nome ? `${q.casas.nome} · ` : ''
                return (
                  <option key={q.id} value={q.id} disabled={ocupado}>
                    {casa}{q.identificacao}{ocupado ? ' (ocupado)' : ''}
                  </option>
                )
              })}
            </select>

            <div className="linha">
              <div>
                <label>Valor do aluguel (R$/mês)</label>
                <input inputMode="decimal" value={editando.valor_aluguel}
                       onChange={e => setEditando({ ...editando, valor_aluguel: e.target.value })}
                       placeholder="0,00" />
              </div>
              <div>
                <label>Dia de vencimento</label>
                <input inputMode="numeric" value={editando.dia_vencimento}
                       onChange={e => setEditando({ ...editando, dia_vencimento: e.target.value })}
                       placeholder="1 a 31" />
              </div>
            </div>

            <label>Caução (R$)</label>
            <input inputMode="decimal" value={editando.caucao_valor}
                   onChange={e => setEditando({ ...editando, caucao_valor: e.target.value })}
                   placeholder="0,00" />

            <div className="linha">
              <div>
                <label>Multa por atraso (%)</label>
                <input inputMode="decimal" value={editando.multa_percentual}
                       onChange={e => setEditando({ ...editando, multa_percentual: e.target.value })}
                       placeholder="ex.: 2" />
              </div>
              <div>
                <label>Juros ao dia (%)</label>
                <input inputMode="decimal" value={editando.juros_dia_percentual}
                       onChange={e => setEditando({ ...editando, juros_dia_percentual: e.target.value })}
                       placeholder="ex.: 0,033" />
              </div>
            </div>

            <label>Desconto por pontualidade (R$)</label>
            <input inputMode="decimal" value={editando.desconto_pontualidade}
                   onChange={e => setEditando({ ...editando, desconto_pontualidade: e.target.value })}
                   placeholder="opcional" />

            <div className="linha">
              <div>
                <label>Início</label>
                <input type="date" value={editando.data_inicio || ''}
                       onChange={e => setEditando({ ...editando, data_inicio: e.target.value })} />
              </div>
              <div>
                <label>Fim (opcional)</label>
                <input type="date" value={editando.data_fim || ''}
                       onChange={e => setEditando({ ...editando, data_fim: e.target.value })} />
              </div>
            </div>

            <label>Status</label>
            <select value={editando.status}
                    onChange={e => setEditando({ ...editando, status: e.target.value })}>
              {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
            </select>
            <p className="sub" style={{ marginTop: 6 }}>
              Contrato vigente marca o quarto como <b>ocupado</b>; encerrar libera o quarto.
            </p>

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
    </div>
  )
}
