-- ============================================================================
-- KitGest — 0008 Restringe de VERDADE o UPDATE de `orgs` por coluna
-- O 0007 não bastou: no PostgreSQL, ter UPDATE na TABELA inteira sobrepõe um
-- REVOKE de coluna. A forma correta é revogar o UPDATE da tabela e reconceder
-- apenas nas colunas que o cliente pode editar (branding). Assim, situacao,
-- acesso_expira_em e recibo_seq ficam fora do alcance do cliente — só o admin
-- (admin_definir_acesso) e as funções SECURITY DEFINER as alteram.
-- SELECT/INSERT/DELETE não são tocados; a RLS de orgs continua valendo.
-- ============================================================================

revoke update on public.orgs from authenticated;
revoke update on public.orgs from anon;

grant update (
  nome, cor_primaria, logo_url,
  pix_tipo, pix_chave, pix_nome_recebedor, pix_cidade,
  telefone, gestao_config
) on public.orgs to authenticated;
