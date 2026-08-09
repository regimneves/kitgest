import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const OrgContext = createContext(null)

export function OrgProvider({ children }) {
  const { user } = useAuth()
  const [org, setOrg] = useState(null)
  const [carregando, setCarregando] = useState(true)

  // Carrega a org do usuário logado (via vínculo em org_membros).
  const recarregar = useCallback(async () => {
    if (!user) { setOrg(null); setCarregando(false); return }
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

  return (
    <OrgContext.Provider value={{ org, carregando, recarregar, criarOrg }}>
      {children}
    </OrgContext.Provider>
  )
}

export const useOrg = () => useContext(OrgContext)
