-- ============================================================================
-- KitGest — Storage buckets + RLS
-- Convenção de caminho: <bucket>/<org_id>/<arquivo>
-- A 1ª pasta do objeto É o org_id, então o RLS reaproveita is_org_member().
-- Fotos/assinaturas devem ser comprimidas no cliente (~1280px) antes do upload.
-- ============================================================================

-- Buckets (privados). 'logos' é público (aparece na tela de login/config).
insert into storage.buckets (id, name, public)
values
  ('logos',          'logos',          true),
  ('comprovantes',   'comprovantes',   false),
  ('vistoria-fotos', 'vistoria-fotos', false),
  ('assinaturas',    'assinaturas',    false),
  ('laudos',         'laudos',         false)
on conflict (id) do nothing;

-- Leitura de logos é pública (bucket public); demais exigem membro da org.
-- storage.foldername(name)[1] = primeira pasta = org_id
create policy kitgest_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'logos'
    or (
      bucket_id in ('comprovantes','vistoria-fotos','assinaturas','laudos')
      and public.is_org_member( (storage.foldername(name))[1]::uuid )
    )
  );

create policy kitgest_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('logos','comprovantes','vistoria-fotos','assinaturas','laudos')
    and public.is_org_member( (storage.foldername(name))[1]::uuid )
  );

create policy kitgest_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('logos','comprovantes','vistoria-fotos','assinaturas','laudos')
    and public.is_org_member( (storage.foldername(name))[1]::uuid )
  );

create policy kitgest_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('logos','comprovantes','vistoria-fotos','assinaturas','laudos')
    and public.is_org_member( (storage.foldername(name))[1]::uuid )
  );
