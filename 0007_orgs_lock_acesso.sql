-- ============================================================================
-- KitGest — 0007 Trava as colunas de acesso da org contra edição pelo cliente
-- A política de UPDATE de `orgs` deixa o dono editar a org (nome, cor, logo,
-- PIX...). Sem isto, ele também poderia estender o PRÓPRIO vencimento e burlar
-- o bloqueio. Revogamos UPDATE apenas nas colunas sensíveis: só o admin as
-- altera (via admin_definir_acesso, SECURITY DEFINER) e o bootstrap_org as
-- define na criação. recibo_seq idem — só a RPC proximo_recibo mexe.
-- O cliente continua editando normalmente todas as demais colunas (branding).
-- ============================================================================

revoke update (situacao, acesso_expira_em, recibo_seq) on public.orgs from authenticated;
revoke update (situacao, acesso_expira_em, recibo_seq) on public.orgs from anon;
