-- ============================================================================
-- KitGest — PENDENTES DE PRODUÇÃO (colar INTEIRO no SQL Editor do projeto real)
-- Projeto: geltxfbwrqmacshwaveh  (conta softia.suporte@gmail.com)
--
-- Diagnóstico em 21/09/2026:
--   • 0009 (inquilinos.documento_url) ....... JÁ APLICADA (coluna existe)
--   • 0010 (função keepalive) ............... FALTA (RPC não existe → 404)
--   • 0008 (trava colunas de acesso) ........ reaplicar por garantia
--
-- Este script é IDEMPOTENTE: pode rodar quantas vezes quiser sem quebrar nada.
-- Rode tudo de uma vez. No fim, a última consulta confirma o que ficou no banco.
-- ============================================================================


-- ── 0008 · Restringe o UPDATE de `orgs` às colunas de branding ───────────────
-- (o cliente NÃO pode esticar a própria licença: situacao/acesso_expira_em
--  ficam fora do alcance; só admin e funções SECURITY DEFINER as alteram.)
revoke update on public.orgs from authenticated;
revoke update on public.orgs from anon;

grant update (
  nome, cor_primaria, logo_url,
  pix_tipo, pix_chave, pix_nome_recebedor, pix_cidade,
  telefone, gestao_config
) on public.orgs to authenticated;


-- ── 0009 · Foto do documento do inquilino (RG/CPF) ───────────────────────────
-- (aditiva; se já existe, não faz nada)
alter table public.inquilinos
  add column if not exists documento_url text;


-- ── 0010 · RPC pública de keepalive (evita o projeto free auto-pausar) ────────
-- Executa uma consulta REAL e devolve 200 p/ a chave anônima = atividade
-- legítima. Não expõe dado nenhum. O workflow do GitHub bate aqui 2x/semana.
create or replace function public.keepalive()
returns text
language sql
security definer
set search_path = public
as $$
  select 'awake ' || now()::text
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;


-- ── Verificação final (deve retornar as 3 linhas todas com ok = true) ────────
select 'keepalive() existe'              as item, exists(
          select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'keepalive') as ok
union all
select 'inquilinos.documento_url existe', exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='inquilinos' and column_name='documento_url')
union all
select 'orgs: UPDATE só em colunas',      not exists(
          select 1 from information_schema.role_table_grants
          where table_schema='public' and table_name='orgs'
            and grantee='authenticated' and privilege_type='UPDATE');
