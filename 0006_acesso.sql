-- ============================================================================
-- KitGest — 0006 Controle de acesso (licença por org: trial / ativa / suspensa)
-- Modelo: cada org (cliente) tem uma SITUAÇÃO e uma data de VENCIMENTO.
-- Conta nova nasce em TRIAL de 14 dias. Ao vencer (ou ser suspensa), o RLS
-- bloqueia leitura E escrita das tabelas de dados — bloqueio real no banco.
-- A org sempre consegue ler o PRÓPRIO status (orgs) para mostrar o aviso/tela.
-- Admin da plataforma (por e-mail) gerencia tudo via RPCs protegidas.
-- ============================================================================

-- 1) Campos de acesso na org ------------------------------------------------
alter table public.orgs
  add column if not exists situacao text not null default 'trial'
    check (situacao in ('trial','ativa','suspensa')),
  add column if not exists acesso_expira_em date;

-- Orgs que JÁ existem não devem ser bloqueadas (grandfather): ativa, sem vencer.
update public.orgs
   set situacao = 'ativa', acesso_expira_em = null
 where situacao = 'trial' and acesso_expira_em is null
   and criado_em < now();

-- 2) Nova org nasce em TRIAL de 14 dias -------------------------------------
create or replace function public.bootstrap_org(p_nome text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'sem usuario autenticado';
  end if;
  insert into public.orgs (nome, situacao, acesso_expira_em)
    values (p_nome, 'trial', (current_date + 14))
    returning id into v_org;
  insert into public.org_membros (org_id, user_id, papel) values (v_org, auth.uid(), 'dono');
  return v_org;
end;
$$;

-- 3) org_liberada(): true se a org pode operar (trial/ativa e não vencida) ---
create or replace function public.org_liberada(p_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.orgs o
     where o.id = p_org
       and o.situacao in ('trial','ativa')
       and (o.acesso_expira_em is null or o.acesso_expira_em >= current_date)
  );
$$;

-- 4) Administradores da plataforma (por e-mail) -----------------------------
create table if not exists public.plataforma_admins (
  email      text primary key,
  criado_em  timestamptz not null default now()
);
alter table public.plataforma_admins enable row level security;
-- sem policy de leitura pública: só as funções SECURITY DEFINER enxergam.
insert into public.plataforma_admins (email) values ('softia.suporte@gmail.com')
  on conflict (email) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.plataforma_admins a
     where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 5) RLS das tabelas de dados: exige membro da org E org liberada ------------
--    (orgs e org_membros ficam de fora: precisam ser legíveis mesmo bloqueado)
do $$
declare t text;
begin
  foreach t in array array[
    'casas','quartos','despesas_casa','quarto_rateio','inquilinos','contratos',
    'recebimentos','vistorias','vistoria_itens','acertos_saida','acerto_itens',
    'manutencao','contas_pagar','contrato_reajustes','avisos_enviados'
  ] loop
    execute format('drop policy if exists %1$s_by_org on public.%1$s;', t);
    execute format(
      'create policy %1$s_by_org on public.%1$s
         for all
         using (public.is_org_member(org_id) and public.org_liberada(org_id))
         with check (public.is_org_member(org_id) and public.org_liberada(org_id));', t);
  end loop;
end $$;

-- Storage: quem está com a org bloqueada também não sobe/baixa arquivos.
drop policy if exists kitgest_storage_insert on storage.objects;
create policy kitgest_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('logos','comprovantes','vistoria-fotos','assinaturas','laudos')
    and public.is_org_member( (storage.foldername(name))[1]::uuid )
    and public.org_liberada( (storage.foldername(name))[1]::uuid )
  );

-- 6) RPCs de administração (só admin) ---------------------------------------
create or replace function public.admin_listar_orgs()
returns table (
  id uuid, nome text, situacao text, acesso_expira_em date,
  criado_em timestamptz, casas bigint, contratos_ativos bigint, ultimo_recebimento date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'acesso restrito ao administrador';
  end if;
  return query
    select o.id, o.nome, o.situacao, o.acesso_expira_em, o.criado_em,
           (select count(*) from public.casas c where c.org_id = o.id),
           (select count(*) from public.contratos ct where ct.org_id = o.id and ct.status in ('ativo','inadimplente')),
           (select max(r.competencia) from public.recebimentos r where r.org_id = o.id and r.status = 'pago')
      from public.orgs o
     order by o.criado_em desc;
end;
$$;

create or replace function public.admin_definir_acesso(
  p_org uuid, p_situacao text, p_expira date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'acesso restrito ao administrador';
  end if;
  if p_situacao not in ('trial','ativa','suspensa') then
    raise exception 'situacao invalida: %', p_situacao;
  end if;
  update public.orgs
     set situacao = p_situacao, acesso_expira_em = p_expira
   where id = p_org;
end;
$$;

-- Permissões
grant execute on function public.org_liberada(uuid)      to authenticated;
grant execute on function public.is_admin()              to authenticated;
grant execute on function public.admin_listar_orgs()     to authenticated;
grant execute on function public.admin_definir_acesso(uuid, text, date) to authenticated;
revoke execute on function public.org_liberada(uuid)     from anon;
revoke execute on function public.is_admin()             from anon;
revoke execute on function public.admin_listar_orgs()    from anon;
revoke execute on function public.admin_definir_acesso(uuid, text, date) from anon;
