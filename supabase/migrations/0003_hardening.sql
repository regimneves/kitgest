-- ============================================================================
-- KitGest — endurecimento pós-advisors (segurança)
-- ============================================================================

-- 1) search_path fixo no trigger (evita function_search_path_mutable)
create or replace function public.set_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

-- 2) Tirar EXECUTE do PUBLIC/anon nas funções SECURITY DEFINER.
--    Só usuários autenticados devem chamar (RLS/RPC). is_org_member roda
--    dentro das policies (contexto do usuário logado), nunca via anon.
revoke execute on function public.is_org_member(uuid)  from public;
revoke execute on function public.bootstrap_org(text)  from public;
revoke execute on function public.proximo_recibo(uuid) from public;

grant execute on function public.is_org_member(uuid)   to authenticated;
grant execute on function public.bootstrap_org(text)   to authenticated;
grant execute on function public.proximo_recibo(uuid)  to authenticated;
