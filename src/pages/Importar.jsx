import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda } from '../lib/format'
import { planejarImportacao, linhasModelo, MODELO, norm } from '../lib/planilha'

// Importa casas + quartos de uma planilha (.xlsx / .csv). 1 linha = 1 quarto;
// o nome da casa se repete e agrupa. SheetJS entra por import dinâmico (code-split).
export default function Importar() {
  const { org } = useOrg()
  const navigate = useNavigate()
  const [casas, setCasas] = useState([])
  const [quartos, setQuartos] = useState([])
  const [plano, setPlano] = useState(null)   // { casasNovas, itens, resumo, casaPorNome }
  const [nomeArquivo, setNomeArquivo] = useState('')
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [processando, setProcessando] = useState(false)

  const carregar = useCallback(async () => {
    const [{ data: cs }, { data: qs }] = await Promise.all([
      supabase.from('casas').select('id,nome'),
      supabase.from('quartos').select('casa_id,identificacao')
    ])
    setCasas(cs || [])
    setQuartos(qs || [])
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function aoEscolherArquivo(e) {
    const file = e.target.files?.[0]
    e.target.value = ''                       // permite reescolher o mesmo arquivo
    if (!file) return
    setErro(''); setOk(''); setPlano(null); setNomeArquivo(file.name)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const linhas = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
      if (!linhas.length) { setErro('A planilha está vazia ou sem cabeçalho na primeira linha.'); return }

      const casaNomeById = Object.fromEntries(casas.map(c => [c.id, c.nome]))
      const quartosExist = quartos.map(q => ({ casa_nome: casaNomeById[q.casa_id] || '', identificacao: q.identificacao }))
      const p = planejarImportacao(linhas, casas, quartosExist)
      if (p.resumo.total === 0) { setErro('Nenhuma linha com dados encontrada. Verifique se os cabeçalhos batem com o modelo (casa, quarto, aluguel…).'); return }
      setPlano(p)
    } catch (err) {
      setErro('Não consegui ler o arquivo: ' + (err?.message || err))
    }
  }

  async function confirmar() {
    if (!plano) return
    setProcessando(true); setErro(''); setOk('')
    try {
      // Mapa norm(nome) -> casa_id (existentes + as que vamos criar)
      const idPorNome = new Map()
      for (const [nc, c] of plano.casaPorNome.entries()) idPorNome.set(nc, c.id)

      // 1) Cria as casas novas
      const novas = [...plano.casasNovas.values()]
      if (novas.length) {
        const payloadCasas = novas.map(c => ({
          org_id: org.id,
          nome: c.nome,
          endereco: c.endereco,
          tipo: 'sublocada',
          aluguel_mae: c.aluguel_mae || 0,
          criterio_rateio: 'igual',
          ativo: true
        }))
        const { data: criadas, error } = await supabase.from('casas').insert(payloadCasas).select('id,nome')
        if (error) throw error
        for (const c of criadas || []) idPorNome.set(norm(c.nome), c.id)
      }

      // 2) Cria os quartos (só os itens marcados "criar")
      const aCriar = plano.itens.filter(x => x.acao === 'criar')
      const payloadQuartos = aCriar.map(x => ({
        org_id: org.id,
        casa_id: idPorNome.get(norm(x.casaNome)),
        identificacao: x.quarto,
        aluguel_base: x.aluguel || 0,
        valor_final: x.aluguel || 0,
        area_m2: x.area_m2,
        capacidade: x.capacidade,
        encargos_inclusos: true,
        status: x.status,
        observacoes: x.obs
      })).filter(q => q.casa_id)   // segurança: só quartos com casa resolvida

      if (payloadQuartos.length) {
        const { error } = await supabase.from('quartos').insert(payloadQuartos)
        if (error) throw error
      }

      setOk(`Importação concluída: ${novas.length} casa(s) e ${payloadQuartos.length} quarto(s) criados.`)
      setPlano(null); setNomeArquivo('')
      await carregar()
    } catch (err) {
      setErro('Falha ao importar: ' + (err?.message || err))
    } finally {
      setProcessando(false)
    }
  }

  async function baixarModelo() {
    const XLSX = await import('xlsx')
    const headers = MODELO.map(m => m.titulo)
    const dados = linhasModelo().map(l => headers.map(h => l[h] ?? ''))
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dados])
    ws['!cols'] = headers.map(h => ({ wch: Math.max(10, h.length + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Casas e Quartos')
    XLSX.writeFile(wb, 'modelo-kitgest-casas-quartos.xlsx')
  }

  const badge = (acao) => {
    const cor = acao === 'criar' ? '#22c55e' : acao === 'duplicado' ? '#eab308' : '#ef4444'
    const txt = acao === 'criar' ? 'criar' : acao === 'duplicado' ? 'ignorar' : 'erro'
    return <span className="tag" style={{ background: cor + '22', color: cor, border: `1px solid ${cor}55` }}>{txt}</span>
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Importar planilha</h1>
          <p className="sub" style={{ margin: 0 }}>Cadastre várias casas e quartos de uma vez a partir de um Excel ou CSV.</p>
        </div>
        <button className="secundario" onClick={() => navigate('/casas')}>Ver casas</button>
      </div>

      {erro && <div className="erro">{erro}</div>}
      {ok && <div className="card mt" style={{ borderColor: '#22c55e' }}><strong style={{ color: '#16a34a' }}>✓ {ok}</strong></div>}

      <div className="card mt">
        <strong>Como funciona</strong>
        <ol className="sub" style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Baixe o modelo e preencha: <b>cada linha é um quarto</b>. Repita o nome da casa nas linhas dos quartos dela.</li>
          <li>Colunas: <code>casa</code>, <code>endereco</code>, <code>aluguel_mae</code>, <code>quarto</code>, <code>aluguel</code>, <code>area_m2</code>, <code>capacidade</code>, <code>status</code>, <code>obs</code>. Só <b>casa</b> e <b>quarto</b> são obrigatórias.</li>
          <li>Envie o arquivo, confira a prévia e clique em <b>Importar</b>. Quartos que já existem são ignorados (não duplica).</li>
        </ol>
        <div className="linha mt">
          <button className="secundario" onClick={baixarModelo}>⬇ Baixar modelo (.xlsx)</button>
          <label className="ouro" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            📄 Escolher planilha
            <input type="file" accept=".xlsx,.xls,.csv" onChange={aoEscolherArquivo} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {plano && (
        <>
          <div className="card mt" style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <Kpi n={plano.resumo.casasNovas} t="casas novas" cor="#22c55e" />
            <Kpi n={plano.resumo.quartosNovos} t="quartos a criar" cor="#22c55e" />
            <Kpi n={plano.resumo.duplicados} t="ignorados (já existem)" cor="#eab308" />
            <Kpi n={plano.resumo.erros} t="com erro" cor="#ef4444" />
          </div>

          <div className="mt" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--borda)' }}>
                  <th style={th}>Linha</th><th style={th}>Casa</th><th style={th}>Quarto</th>
                  <th style={th}>Aluguel</th><th style={th}>Status</th><th style={th}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {plano.itens.map((x, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--borda)', opacity: x.acao === 'criar' ? 1 : .6 }}>
                    <td style={td}>{x.linha}</td>
                    <td style={td}>{x.casaNome || <em className="sub">—</em>}</td>
                    <td style={td}>{x.quarto || <em className="sub">—</em>}</td>
                    <td style={td}>{x.aluguel ? formatarMoeda(x.aluguel) : '—'}</td>
                    <td style={td}>{x.status}</td>
                    <td style={td}>{badge(x.acao)} {x.motivo && <span className="sub" style={{ fontSize: '.8rem' }}>{x.motivo}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="linha mt" style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', paddingTop: 8 }}>
            <button className="secundario" onClick={() => { setPlano(null); setNomeArquivo('') }}>Cancelar</button>
            <button className="ouro" onClick={confirmar} disabled={processando || plano.resumo.quartosNovos === 0}>
              {processando ? 'Importando…' : `Importar ${plano.resumo.quartosNovos} quarto(s)`}
            </button>
          </div>
          {nomeArquivo && <p className="sub" style={{ marginTop: 6 }}>Arquivo: {nomeArquivo}</p>}
        </>
      )}
    </div>
  )
}

function Kpi({ n, t, cor }) {
  return (
    <div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color: cor }}>{n}</div>
      <div className="sub" style={{ margin: 0 }}>{t}</div>
    </div>
  )
}

const th = { padding: '8px 10px', fontWeight: 600, color: 'var(--texto-fraco)' }
const td = { padding: '8px 10px' }
