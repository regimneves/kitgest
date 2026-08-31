import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const OrgContext = createContext(null)

// Calcula a situação de acesso a partir da org.
function calcAcesso(org) {
  if (!org) return { bloqueado: false, diasRestantes: null, motivo: null }
  if (org.situacao === 'suspensa') {
    return { bloqueado: true, diasRestantes: null, motivo: 'suspensa' }
  }
  if (org.acesso_expira_em) {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
    const venc = new Date(org.acesso_expira_em + 'T00:00:00')
    const dias = Math.round((venc - hoje) / 86400000)
    if (dias < 0) return { bloqueado: true, diasRestantes: dias, motivo: 'vencido' }
    return { bloqueado: false, diasRestantes: dias, motivo: null }
  }
  return { bloqueado: false, diasRestantes: null, motivo: null }
}

export function OrgProvider({ children }) {
  const { user } = useAuth()
  const [org, setOrg] = useState(null)
  const [ehAdmin, setEhAdmin] = useState(false)
  const [carregando, setCarregando] = useState(true)

  // Carrega a org do usuário logado (via vínculo em org_membros).
  const recarregar = useCallback(async () => {
    if (!user) { setOrg(null); setEhAdmin(false); setCarregando(false); return }
    setCarregando(true)
    const { data: vinc } = await supabase
      .from('org_membros')
      .select('org_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!vinc) { setOrg(null); setCarregando(false); return }

    const { data: o } = await supabase
      .from('orgs')
      .select('*')
      .eq('id', vinc.org_id)
      .maybeSingle()

    setOrg(o ?? null)

    // É administrador da plataforma? (checagem real no servidor)
    const { data: adm } = await supabase.rpc('is_admin')
    setEhAdmin(adm === true)

    setCarregando(false)
  }, [user])

  useEffect(() => { recarregar() }, [recarregar])

  // Aplica a cor do sistema (branding) como variável CSS.
  useEffect(() => {
    if (org?.cor_primaria) {
      document.documentElement.style.setProperty('--cor-primaria', org.cor_primaria)
    }
  }, [org?.cor_primaria])

  // 1ª configuração: cria a org e vincula o usuário como dono.
  const criarOrg = async (nome) => {
    const { data, error } = await supabase.rpc('bootstrap_org', { p_nome: nome })
    if (error) throw error
    await recarregar()
    return data
  }

  const acesso = calcAcesso(org)

  return (
    <OrgContext.Provider value={{ org, carregando, recarregar, criarOrg, ehAdmin, ...acesso }}>
      {children}
    </OrgContext.Provider>
  )
}

export const useOrg = () => useContext(OrgContext)
