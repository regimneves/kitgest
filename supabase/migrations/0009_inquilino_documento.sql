-- ============================================================================
-- KitGest — Foto do documento do inquilino (RG/CPF)
-- Guarda apenas o CAMINHO no Storage (bucket privado `comprovantes`,
-- caminho <org_id>/documentos/<uuid>.jpg). O arquivo em si já é protegido
-- pelas políticas de storage existentes (is_org_member sobre a 1ª pasta).
-- Aditiva e reversível: `alter table ... drop column documento_url;`
-- ============================================================================

alter table public.inquilinos
  add column if not exists documento_url text;
