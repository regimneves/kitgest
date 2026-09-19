-- ============================================================================
-- KitGest — RPC pública de keepalive (mantém o projeto free "acordado")
--
-- POR QUÊ: o keepalive antigo batia em /rest/v1/orgs com a chave anônima e
-- recebia 401 (RLS bloqueia). Requisição RECUSADA não conta como atividade,
-- então o projeto pausava mesmo "pingando" 2x/semana (pausou ~3 dias após um
-- ping que retornou 401 em 07/09).
--
-- ESTA FUNÇÃO executa uma consulta REAL no Postgres e devolve 200 para a chave
-- anônima — atividade legítima. Não expõe dado nenhum (só um texto + timestamp).
-- SECURITY DEFINER + search_path travado = sem brecha de escalonamento.
-- ============================================================================

create or replace function public.keepalive()
returns text
language sql
security definer
set search_path = public
as $$
  select 'awake ' || now()::text
$$;

-- Só quem deve executar: anon (o workflow) e usuários logados. Tira o resto.
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
