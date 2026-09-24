import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { formatarMoeda, formatarData, formatarCompetencia } from '../lib/format'
import { coletarBackup, salvarBackupLocal, lerBackupLocal, ultimoBackupEm } from '../lib/backupLocal'

// Dispara download de um conteúdo como arquivo.
function baixarArquivo(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function slug(s) {
  return String(s || 'kitgest').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'kitgest'
}
const carimbo = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : null)

// CSV padrão BR (separador ; e vírgula decimal via formatarMoeda quando aplicável).
function paraCSV(linhas) {
  const esc = v => {
    const s = v == null ? '' : String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + linhas.map(l => l.map(esc).join(';')).join('\r\n')
}

export default function Backup() {
  const { org } = useOrg()
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [resumo, setResumo] = useState(null)
  const [feito, setFeito] = useState('')
  const [autoEm, setAutoEm] = useState(ultimoBackupEm())

  useEffect(() => { setAutoEm(ultimoBackupEm()) }, [feito])

  async function gerarBackup() {
    setErro(''); setFeito(''); setCarregando(true)
    try {
      const { dados, contagem } = await coletarBackup(org)
      setResumo({ contagem })
      baixarArquivo(`kitgest-backup-${slug(org?.nome)}-${carimbo()}.json`, JSON.stringify(dados, null, 2), 'application/json')
      await salvarBackupLocal(dados) // atualiza a cópia local (conta como backup da semana)
      setFeito('Backup completo (.json) baixado. Guarde este arquivo na nuvem ou num pen drive.')
    } catch (e) {
      setErro('Não foi possível gerar o backup: ' + e.message)
    } finally { setCarregando(false) }
  }

  // Baixa a cópia local automática já guardada no aparelho.
  async function baixarCopiaAutomatica() {
    setErro(''); setFeito('')
    const snap = await lerBackupLocal()
    if (!snap?.dados) { setErro('Ainda não há cópia automática neste aparelho. Use “Baixar backup completo”.'); return }
    baixarArquivo(`kitgest-backup-auto-${slug(org?.nome)}-${carimbo()}.json`, JSON.stringify(snap.dados, null, 2), 'application/json')
    setFeito(`Cópia automática (de ${dataHora(snap.em)}) baixada.`)
  }

  async function csvRecebimentos() {
    setErro(''); setFeito(''); setCarregando(true)
    try {
      const { data, error } = await supabase.from('recebimentos')
        .select('competencia, valor, status, forma, pago_em, recibo_numero, inquilinos(nome), quartos(identificacao, casas(nome))')
        .order('competencia', { ascending: false })
      if (error) throw error
      const linhas = [['Competência', 'Casa', 'Quarto', 'Inquilino', 'Valor', 'Status', 'Forma', 'Pago em', 'Recibo']]
      for (const r of data || []) {
        linhas.push([
          formatarCompetencia(r.competencia),
          r.quartos?.casas?.nome || '', r.quartos?.identificacao || '',
          r.inquilinos?.nome || '', formatarMoeda(r.valor),
          r.status || '', r.forma || '',
          r.pago_em ? formatarData(r.pago_em) : '',
          r.recibo_numero != null ? String(r.recibo_numero).padStart(4, '0') : ''
        ])
      }
      baixarArquivo(`kitgest-recebimentos-${slug(org?.nome)}-${carimbo()}.csv`, paraCSV(linhas), 'text/csv;charset=utf-8')
      setFeito('Planilha de recebimentos (.csv) baixada — abre no Excel.')
    } catch (e) { setErro('Erro no CSV: ' + e.message) } finally { setCarregando(false) }
  }

  async function csvRentRoll() {
    setErro(''); setFeito(''); setCarregando(true)
    try {
      const { data, error } = await supabase.from('contratos')
        .select('valor_aluguel, dia_vencimento, caucao_valor, status, data_inicio, inquilinos(nome, telefone), quartos(identificacao, casas(nome))')
        .in('status', ['ativo', 'inadimplente', 'pendente'])
      if (error) throw error
      const linhas = [['Casa', 'Quarto', 'Inquilino', 'Telefone', 'Aluguel', 'Vencimento (dia)', 'Caução', 'Status', 'Início']]
      for (const c of data || []) {
        linhas.push([
          c.quartos?.casas?.nome || '', c.quartos?.identificacao || '',
          c.inquilinos?.nome || '', c.inquilinos?.telefone || '',
          formatarMoeda(c.valor_aluguel), c.dia_vencimento || '',
          formatarMoeda(c.caucao_valor), c.status || '',
          c.data_inicio ? formatarData(c.data_inicio) : ''
        ])
      }
      baixarArquivo(`kitgest-inquilinos-${slug(org?.nome)}-${carimbo()}.csv`, paraCSV(linhas), 'text/csv;charset=utf-8')
      setFeito('Planilha de inquilinos/contratos vigentes (.csv) baixada.')
    } catch (e) { setErro('Erro no CSV: ' + e.message) } finally { setCarregando(false) }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1>Backup dos dados</h1>
      <p className="sub">Uma cópia dos seus dados para não correr risco de perder nada.</p>

      {/* Backup automático */}
      <div className="card mt" style={{ borderColor: autoEm ? '#22c55e' : 'var(--cor-ouro)' }}>
        <strong>🔄 Backup automático semanal</strong>
        <p className="sub" style={{ marginBottom: 8 }}>
          O sistema guarda sozinho uma cópia neste aparelho a cada semana, sempre substituindo a anterior.
          {autoEm
            ? <> Última cópia automática: <b>{dataHora(autoEm)}</b>.</>
            : <> Ainda não há cópia automática — ela será criada em breve, ou gere uma agora abaixo.</>}
        </p>
        <button className="secundario" onClick={baixarCopiaAutomatica} disabled={carregando || !autoEm}>⬇ Baixar a cópia automática</button>
      </div>

      <div className="card mt">
        <strong>Backup completo (.json)</strong>
        <p className="sub">Cópia de <b>tudo</b>: casas, quartos, inquilinos, contratos, recebimentos, vistorias, contas a pagar e mais. É o arquivo que permite restaurar os dados. Recomendado baixar toda semana e guardar fora do aparelho (nuvem/pen drive).</p>
        <button className="ouro" onClick={gerarBackup} disabled={carregando}>
          {carregando ? 'Gerando…' : '⬇ Baixar backup completo'}
        </button>
      </div>

      <div className="card mt">
        <strong>Planilhas (.csv) — abrem no Excel</strong>
        <p className="sub">Para conferência e contabilidade. Não substituem o backup completo.</p>
        <div className="linha" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="secundario" onClick={csvRecebimentos} disabled={carregando}>⬇ Recebimentos</button>
          <button className="secundario" onClick={csvRentRoll} disabled={carregando}>⬇ Inquilinos / contratos</button>
        </div>
      </div>

      {erro && <div className="erro">{erro}</div>}
      {feito && (
        <div className="card mt" style={{ borderColor: '#22c55e' }}>
          <strong>✅ Pronto</strong>
          <p className="sub" style={{ marginBottom: 0 }}>{feito}</p>
        </div>
      )}

      {resumo && (
        <div className="card mt">
          <strong>Conteúdo do último backup</strong>
          <div className="sub" style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 4 }}>
            {Object.entries(resumo.contagem).map(([t, n]) => (
              <div key={t}>{t}: <b>{n}</b></div>
            ))}
          </div>
        </div>
      )}

      <p className="sub mt" style={{ fontSize: '.8rem' }}>
        Para <b>restaurar</b> um backup, fale com o suporte e envie o arquivo <code>.json</code> — a importação é feita com acompanhamento para não duplicar dados.
      </p>
    </div>
  )
}
