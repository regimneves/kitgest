// Backup dos dados da org: coleta tudo, guarda uma cópia local (IndexedDB) que é
// SOBRESCRITA a cada backup (só a mais recente fica) e roda automaticamente 1x/semana.
import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

// Tabelas de dados da org (a RLS já devolve só as linhas desta conta).
export const TABELAS = [
  'casas', 'quartos', 'despesas_casa', 'quarto_rateio',
  'inquilinos', 'contratos', 'recebimentos',
  'vistorias', 'vistoria_itens', 'acertos_saida', 'acerto_itens',
  'manutencao', 'contas_pagar', 'contrato_reajustes', 'avisos_enviados'
]

// Busca tudo da org → { dados, contagem }.
export async function coletarBackup(org) {
  const dados = {
    _meta: { app: 'KitGest', gerado_em: new Date().toISOString(), org: org?.nome || null, org_id: org?.id || null, versao_backup: 1 }
  }
  const contagem = {}
  dados.org = {
    id: org.id, nome: org.nome, endereco: org.endereco || null,
    telefone: org.telefone || null, cor_primaria: org.cor_primaria || null,
    pix_chave: org.pix_chave || null, pix_nome_recebedor: org.pix_nome_recebedor || null,
    pix_cidade: org.pix_cidade || null, gestao_config: org.gestao_config || null
  }
  for (const t of TABELAS) {
    const { data, error } = await supabase.from(t).select('*')
    if (error) throw new Error(`${t}: ${error.message}`)
    dados[t] = data || []
    contagem[t] = (data || []).length
  }
  return { dados, contagem }
}

// ---- Cópia local (IndexedDB) — uma única chave 'ultimo', sempre sobrescrita ----
const DB_NOME = 'kitgest-backup'
const STORE = 'snap'

function abrirIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NOME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}
async function idbPut(chave, valor) {
  const db = await abrirIDB()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(valor, chave)
    tx.oncomplete = () => { db.close(); res() }
    tx.onerror = () => rej(tx.error)
  })
}
async function idbGet(chave) {
  const db = await abrirIDB()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly')
    const rq = tx.objectStore(STORE).get(chave)
    rq.onsuccess = () => { db.close(); res(rq.result) }
    rq.onerror = () => rej(rq.error)
  })
}

const CHAVE_DATA = 'kitgest_backup_em'

// Salva a cópia local (sobrescreve a anterior) e registra a data.
export async function salvarBackupLocal(dados) {
  const em = new Date().toISOString()
  await idbPut('ultimo', { dados, em })
  try { localStorage.setItem(CHAVE_DATA, em) } catch { /* ignore */ }
  return em
}
export async function lerBackupLocal() {
  try { return await idbGet('ultimo') } catch { return null }
}
export function ultimoBackupEm() {
  try { return localStorage.getItem(CHAVE_DATA) } catch { return null }
}

const UMA_SEMANA = 7 * 24 * 60 * 60 * 1000
export function deveFazerBackup() {
  const em = ultimoBackupEm()
  if (!em) return true
  const t = new Date(em).getTime()
  return !Number.isFinite(t) || (Date.now() - t) > UMA_SEMANA
}

// Hook: dispara o backup automático (silencioso) 1x por semana quando a org está carregada.
export function useBackupAutomatico(org) {
  const feito = useRef(false)
  useEffect(() => {
    if (!org?.id || feito.current) return
    if (!deveFazerBackup()) return
    feito.current = true
    ;(async () => {
      try {
        const { dados } = await coletarBackup(org)
        await salvarBackupLocal(dados)
      } catch { /* silencioso: não atrapalha o uso */ }
    })()
  }, [org?.id]) // eslint-disable-line react-hooks/exhaustive-deps
}
