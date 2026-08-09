-- ============================================================================
-- KitGest — revogar EXECUTE do papel anon nas funções SECURITY DEFINER
-- (Supabase concede EXECUTE ao anon explicitamente, além do PUBLIC).
-- Só usuários autenticados chamam essas RPCs / usam no RLS.
-- ============================================================================
revoke execute on function public.is_org_member(uuid)  from anon;
revoke execute on function public.bootstrap_org(text)  from anon;
revoke execute on function public.proximo_recibo(uuid) from anon;
