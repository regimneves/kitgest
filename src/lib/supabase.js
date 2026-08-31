import { createClient } from '@supabase/supabase-js'

// Projeto Supabase do KitGest (conta softia.suporte, sa-east-1). A chave
// publishable é segura no cliente — o RLS protege os dados. Fica como fallback
// para o deploy funcionar mesmo se o build rodar sem as variáveis VITE_* do ambiente.
const URL_PADRAO = 'https://geltxfbwrqmacshwaveh.supabase.co'
const KEY_PADRAO = 'sb_publishable_MnG02iBufzW0rQ9taraJ1A_jdIvP_US'

const url = import.meta.env.VITE_SUPABASE_URL || URL_PADRAO
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || KEY_PADRAO

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
})
