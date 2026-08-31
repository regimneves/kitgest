-- ============================================================================
-- KitGest — SETUP COMPLETO para projeto NOVO (conta Supabase nova)
-- Cole TUDO isto no SQL Editor do projeto novo e clique RUN.
-- Consolida as migrations 0001..0005 (schema + RLS + storage + gestão).
-- Gerado em: 2026-08-31 10:52
-- ============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>> migrations/0001_init.sql >>>>>>>>>>>>>>>>>>>>>>>>

-- ============================================================================
-- KitGest — schema inicial (v1)
-- Produto Softia: gestão de kitnets sublocadas (PWA + Supabase)
-- Multi-tenant desde o dia 1: TODA tabela carrega org_id + RLS ligado.
-- Convenções: snake_case, uuid pk, timestamptz criado_em/atualizado_em,
-- enums como TEXT + CHECK (fácil de estender sem ALTER TYPE),
-- valores em dinheiro como numeric(12,2).
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Atualiza atualizado_em em todo UPDATE
create or replace function public.set_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

-- ============================================================================
-- ORG (conta da operadora) + membros
-- A org é o tenant. org_membros liga auth.users -> org e alimenta o RLS.
-- ============================================================================

create table public.orgs (
  id                  uuid primary key default gen_random_uuid(),
  nome                text,                         -- em branco: cliente preenche na config
  cor_primaria        text default '#1e293b',       -- tema do sistema (config)
  logo_url            text,                         -- storage: bucket logos
  -- PIX (recebimento) — cliente preenche na config; QR/BR Code é client-side
  pix_tipo            text check (pix_tipo in ('cpf','cnpj','celular','email','aleatoria')),
  pix_chave           text,
  pix_nome_recebedor  text,
  pix_cidade          text,
  telefone            text,
  recibo_seq          integer not null default 0,   -- contador de recibos (ver proximo_recibo)
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create table public.org_membros (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  papel          text not null default 'operador' check (papel in ('dono','operador')),
  criado_em      timestamptz not null default now(),
  unique (org_id, user_id)
);
create index idx_org_membros_user on public.org_membros(user_id);
create index idx_org_membros_org  on public.org_membros(org_id);

-- Verifica se o usuário logado pertence à org (SECURITY DEFINER evita recursão no RLS)
create or replace function public.is_org_member(target uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_membros m
    where m.org_id = target and m.user_id = auth.uid()
  );
$$;

-- Cria a org na 1ª configuração e vincula o usuário logado como dono.
-- Chamada pela tela de configuração do app (RPC). Retorna o id da org.
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
  insert into public.orgs(nome) values (p_nome) returning id into v_org;
  insert into public.org_membros(org_id, user_id, papel) values (v_org, auth.uid(), 'dono');
  return v_org;
end;
$$;

-- Numeração sequencial de recibos por org (atômica). Usar em recebimentos/acertos.
create or replace function public.proximo_recibo(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer;
begin
  update public.orgs set recibo_seq = recibo_seq + 1
    where id = p_org and public.is_org_member(p_org)
    returning recibo_seq into v;
  if v is null then
    raise exception 'org inexistente ou sem permissao';
  end if;
  return v;
end;
$$;

-- ============================================================================
-- ESTRUTURA: casas -> quartos
-- ============================================================================

create table public.casas (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  nome            text not null,                    -- apelido/identificação da casa
  endereco        text,
  -- Todas sublocadas por padrão (aluguel-mãe + margem); 'propria' fica latente
  tipo            text not null default 'sublocada' check (tipo in ('propria','sublocada')),
  aluguel_mae     numeric(12,2) default 0,          -- custo da locação-mãe (sublocada)
  -- Critério de rateio das despesas embutidas no aluguel dos quartos
  criterio_rateio text not null default 'igual' check (criterio_rateio in ('igual','area_m2','moradores')),
  qtd_quartos_ref integer,                          -- referência (varia por reforma)
  observacoes     text,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index idx_casas_org on public.casas(org_id);

create table public.quartos (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs(id) on delete cascade,
  casa_id            uuid not null references public.casas(id) on delete cascade,
  identificacao      text not null,                 -- nº/nome do quarto
  aluguel_base       numeric(12,2) not null default 0,  -- antes do rateio
  valor_final        numeric(12,2) not null default 0,  -- base + rateio embutido (cobrado)
  area_m2            numeric(8,2),                  -- p/ rateio por m²
  capacidade         integer default 1,            -- moradores (p/ rateio por moradores)
  encargos_inclusos  boolean not null default true, -- água/luz/etc inclusos no aluguel (v1)
  status             text not null default 'vago'
                       check (status in ('vago','ocupado','manutencao','reservado')),
  observacoes        text,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create index idx_quartos_org    on public.quartos(org_id);
create index idx_quartos_casa   on public.quartos(casa_id);
create index idx_quartos_status on public.quartos(org_id, status);

-- ============================================================================
-- DESPESAS da casa + snapshot do rateio (composição do aluguel)
-- ============================================================================

create table public.despesas_casa (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  casa_id       uuid not null references public.casas(id) on delete cascade,
  tipo          text not null check (tipo in
                  ('energia','agua','gas','internet','iptu','limpeza','seguro','outro')),
  descricao     text,
  valor         numeric(12,2) not null default 0,
  competencia   date,                              -- mês de referência (use dia 1)
  recorrente    boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index idx_despesas_org  on public.despesas_casa(org_id);
create index idx_despesas_casa on public.despesas_casa(casa_id);

-- Snapshot da composição do aluguel do quarto por competência (rastreável p/ reajuste).
-- detalhe = jsonb com a quebra por despesa: [{tipo, valor_rateado}, ...]
create table public.quarto_rateio (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  quarto_id     uuid not null references public.quartos(id) on delete cascade,
  competencia   date not null,
  base          numeric(12,2) not null default 0,
  total_rateio  numeric(12,2) not null default 0,
  valor_final   numeric(12,2) not null default 0,
  detalhe       jsonb not null default '[]'::jsonb,
  criado_em     timestamptz not null default now(),
  unique (quarto_id, competencia)
);
create index idx_rateio_org    on public.quarto_rateio(org_id);
create index idx_rateio_quarto on public.quarto_rateio(quarto_id);

-- ============================================================================
-- INQUILINOS e CONTRATOS (condições de pagamento)
-- ============================================================================

create table public.inquilinos (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  nome                text not null,
  cpf                 text,
  telefone            text,                          -- p/ botão wa.me
  email               text,
  contato_emergencia  text,
  observacoes         text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index idx_inquilinos_org on public.inquilinos(org_id);

create table public.contratos (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  quarto_id           uuid not null references public.quartos(id) on delete restrict,
  inquilino_id        uuid not null references public.inquilinos(id) on delete restrict,
  -- v1 foca 'mensal'; diária/semanal/varios_meses ficam latentes (sem migração futura)
  periodicidade       text not null default 'mensal'
                        check (periodicidade in ('diaria','semanal','mensal','varios_meses')),
  dia_vencimento      integer check (dia_vencimento between 1 and 31),
  valor_aluguel       numeric(12,2) not null default 0,  -- snapshot do valor_final na assinatura
  caucao_valor        numeric(12,2) not null default 0,
  multa_percentual    numeric(6,3) default 0,        -- multa por atraso (%)
  juros_dia_percentual numeric(6,3) default 0,       -- juros ao dia (%)
  desconto_pontualidade numeric(12,2) default 0,     -- desconto se pagar em dia
  data_inicio         date,
  data_fim            date,
  status              text not null default 'ativo'
                        check (status in ('ativo','encerrado','inadimplente','pendente')),
  observacoes         text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index idx_contratos_org       on public.contratos(org_id);
create index idx_contratos_quarto    on public.contratos(quarto_id);
create index idx_contratos_inquilino on public.contratos(inquilino_id);
create index idx_contratos_status    on public.contratos(org_id, status);

-- ============================================================================
-- RECEBIMENTOS (aluguel) + recibo/comprovante
-- ============================================================================

create table public.recebimentos (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  contrato_id      uuid not null references public.contratos(id) on delete cascade,
  quarto_id        uuid references public.quartos(id) on delete set null,     -- denorm p/ consulta
  inquilino_id     uuid references public.inquilinos(id) on delete set null,  -- denorm p/ consulta
  competencia      date not null,                  -- mês de referência (dia 1)
  valor            numeric(12,2) not null default 0,
  forma            text check (forma in ('dinheiro','pix','transferencia','cartao','outro')),
  status           text not null default 'pendente'
                     check (status in ('pendente','parcial','pago','atrasado')),
  pago_em          timestamptz,
  recibo_numero    integer,                         -- via proximo_recibo(org)
  comprovante_url  text,                            -- storage: bucket comprovantes
  observacoes      text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index idx_receb_org         on public.recebimentos(org_id);
create index idx_receb_contrato    on public.recebimentos(contrato_id);
create index idx_receb_status      on public.recebimentos(org_id, status);
create index idx_receb_competencia on public.recebimentos(org_id, competencia);

-- ============================================================================
-- VISTORIAS (entrada/saída) + itens (checklist + fotos)
-- ============================================================================

create table public.vistorias (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  contrato_id    uuid references public.contratos(id) on delete set null,
  quarto_id      uuid not null references public.quartos(id) on delete cascade,
  tipo           text not null check (tipo in ('entrada','saida')),
  realizada_em   timestamptz,
  responsavel    text,
  assinatura_url text,                              -- storage: bucket assinaturas
  laudo_pdf_url  text,                              -- storage: bucket laudos (jsPDF)
  observacoes    text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index idx_vistorias_org      on public.vistorias(org_id);
create index idx_vistorias_quarto   on public.vistorias(quarto_id);
create index idx_vistorias_contrato on public.vistorias(contrato_id);

create table public.vistoria_itens (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  vistoria_id  uuid not null references public.vistorias(id) on delete cascade,
  ambiente     text,                               -- ex.: quarto, banheiro, cozinha
  item         text not null,                      -- ex.: parede, chuveiro, pia
  condicao     text not null default 'ok' check (condicao in ('ok','avaria','observacao')),
  descricao    text,
  fotos        jsonb not null default '[]'::jsonb, -- array de urls (storage: vistoria-fotos)
  criado_em    timestamptz not null default now()
);
create index idx_vist_itens_org      on public.vistoria_itens(org_id);
create index idx_vist_itens_vistoria on public.vistoria_itens(vistoria_id);

-- ============================================================================
-- ACERTO DE SAÍDA (caução − descontos = a devolver) + itens flexíveis
-- ============================================================================

create table public.acertos_saida (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  contrato_id       uuid not null references public.contratos(id) on delete cascade,
  vistoria_saida_id uuid references public.vistorias(id) on delete set null,
  caucao_valor      numeric(12,2) not null default 0,
  total_descontos   numeric(12,2) not null default 0,   -- soma dos acerto_itens
  valor_a_devolver  numeric(12,2) not null default 0,    -- caução − descontos (pode ser negativo = a cobrar)
  realizado_em      timestamptz,
  recibo_numero     integer,                             -- via proximo_recibo(org)
  comprovante_url   text,
  observacoes       text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index idx_acertos_org      on public.acertos_saida(org_id);
create index idx_acertos_contrato on public.acertos_saida(contrato_id);

-- Linhas de desconto do acerto (dano/pendência/limpeza/chave/outro) — qualquer nº
create table public.acerto_itens (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  acerto_id  uuid not null references public.acertos_saida(id) on delete cascade,
  tipo       text not null check (tipo in ('dano','pendencia','limpeza','chave','outro')),
  descricao  text,
  valor      numeric(12,2) not null default 0,
  criado_em  timestamptz not null default now()
);
create index idx_acerto_itens_org    on public.acerto_itens(org_id);
create index idx_acerto_itens_acerto on public.acerto_itens(acerto_id);

-- ============================================================================
-- MANUTENÇÃO (ordem rápida no celular)
-- ============================================================================

create table public.manutencao (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  casa_id       uuid references public.casas(id) on delete set null,
  quarto_id     uuid references public.quartos(id) on delete set null,
  titulo        text not null,
  descricao     text,
  prioridade    text not null default 'media' check (prioridade in ('baixa','media','alta')),
  status        text not null default 'aberta' check (status in ('aberta','em_andamento','concluida')),
  responsavel   text,
  custo         numeric(12,2) default 0,
  fotos         jsonb not null default '[]'::jsonb,
  aberto_em     timestamptz not null default now(),
  concluido_em  timestamptz,
  atualizado_em timestamptz not null default now()
);
create index idx_manut_org    on public.manutencao(org_id);
create index idx_manut_status on public.manutencao(org_id, status);

-- ============================================================================
-- Triggers de atualizado_em
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'orgs','casas','quartos','despesas_casa','inquilinos','contratos',
    'recebimentos','vistorias','acertos_saida','manutencao'
  ] loop
    execute format(
      'create trigger trg_%1$s_atualizado before update on public.%1$s
         for each row execute function public.set_atualizado_em();', t);
  end loop;
end $$;

-- ============================================================================
-- RLS — LIGADO em todas as tabelas. Acesso = ser membro da org.
-- (Supabase deixa RLS desligado por padrão; sem isto a tabela fica pública.)
-- Testar SEMPRE pelo app: o SQL Editor roda como service_role e ignora RLS.
-- ============================================================================

-- org_membros: usuário só enxerga os próprios vínculos
alter table public.org_membros enable row level security;
create policy org_membros_self on public.org_membros
  for select using (user_id = auth.uid());

-- orgs: membro enxerga/edita a própria org (criação é via bootstrap_org)
alter table public.orgs enable row level security;
create policy orgs_select on public.orgs
  for select using (public.is_org_member(id));
create policy orgs_update on public.orgs
  for update using (public.is_org_member(id)) with check (public.is_org_member(id));

-- Demais tabelas: política uniforme por org_id (ALL = select/insert/update/delete)
do $$
declare t text;
begin
  foreach t in array array[
    'casas','quartos','despesas_casa','quarto_rateio','inquilinos','contratos',
    'recebimentos','vistorias','vistoria_itens','acertos_saida','acerto_itens','manutencao'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy %1$s_by_org on public.%1$s
         for all
         using (public.is_org_member(org_id))
         with check (public.is_org_member(org_id));', t);
  end loop;
end $$;

-- Permissões de execução das RPCs para usuários autenticados
grant execute on function public.bootstrap_org(text) to authenticated;
grant execute on function public.proximo_recibo(uuid) to authenticated;
grant execute on function public.is_org_member(uuid)   to authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>> migrations/0002_storage.sql >>>>>>>>>>>>>>>>>>>>>>>>

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

-- >>>>>>>>>>>>>>>>>>>>>>>> migrations/0003_hardening.sql >>>>>>>>>>>>>>>>>>>>>>>>

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

-- >>>>>>>>>>>>>>>>>>>>>>>> migrations/0004_revoke_anon_exec.sql >>>>>>>>>>>>>>>>>>>>>>>>

-- ============================================================================
-- KitGest — revogar EXECUTE do papel anon nas funções SECURITY DEFINER
-- (Supabase concede EXECUTE ao anon explicitamente, além do PUBLIC).
-- Só usuários autenticados chamam essas RPCs / usam no RLS.
-- ============================================================================
revoke execute on function public.is_org_member(uuid)  from anon;
revoke execute on function public.bootstrap_org(text)  from anon;
revoke execute on function public.proximo_recibo(uuid) from anon;

-- >>>>>>>>>>>>>>>>>>>>>>>> migrations/0005_gestao.sql >>>>>>>>>>>>>>>>>>>>>>>>

-- ============================================================================
-- KitGest — 0005 Gestão: contas a pagar, reajuste de contrato, config de gestão
-- Leva "ferramentas de gestão": fecha a equação do dinheiro (contas a pagar +
-- fluxo de caixa), central de alertas e reajuste/vencimento de contratos, além
-- de avisos de vencimento (marcos configuráveis) ao inquilino.
-- ============================================================================

-- CONTAS A PAGAR (aluguel-mãe + despesas com vencimento; o outro lado do caixa)
create table if not exists public.contas_pagar (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  casa_id       uuid references public.casas(id) on delete set null,  -- null = geral
  tipo          text not null check (tipo in
                  ('aluguel_mae','energia','agua','gas','internet','iptu','limpeza','seguro','funcionario','outro')),
  descricao     text,
  valor         numeric(12,2) not null default 0,
  competencia   date,                              -- mês de referência (dia 1)
  vencimento    date,
  pago          boolean not null default false,
  pago_em       timestamptz,
  observacoes   text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_contas_org         on public.contas_pagar(org_id);
create index if not exists idx_contas_casa        on public.contas_pagar(casa_id);
create index if not exists idx_contas_competencia on public.contas_pagar(org_id, competencia);
create index if not exists idx_contas_pago        on public.contas_pagar(org_id, pago);

-- REAJUSTE de contrato: colunas + histórico
alter table public.contratos
  add column if not exists data_ultimo_reajuste date,
  add column if not exists indice_reajuste text
    check (indice_reajuste in ('igpm','ipca','inpc','fixo','outro'));

create table if not exists public.contrato_reajustes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  contrato_id    uuid not null references public.contratos(id) on delete cascade,
  data           date not null default current_date,
  indice         text,
  percentual     numeric(6,3),
  valor_anterior numeric(12,2),
  valor_novo     numeric(12,2),
  observacoes    text,
  criado_em      timestamptz not null default now()
);
create index if not exists idx_reajustes_org      on public.contrato_reajustes(org_id);
create index if not exists idx_reajustes_contrato on public.contrato_reajustes(contrato_id);

-- AVISOS enviados (marcos 7/2/0 dias) — cross-device (melhor que localStorage)
create table if not exists public.avisos_enviados (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  contrato_id  uuid not null references public.contratos(id) on delete cascade,
  competencia  date not null,
  marco        integer not null,                  -- offset em dias (7,2,0)
  enviado_em   timestamptz not null default now(),
  unique (contrato_id, competencia, marco)
);
create index if not exists idx_avisos_org on public.avisos_enviados(org_id);

-- CONFIG de gestão (marcos de aviso + limiares de alerta) na org
alter table public.orgs
  add column if not exists gestao_config jsonb not null default '{}'::jsonb;

-- Triggers de atualizado_em
create trigger trg_contas_pagar_atualizado before update on public.contas_pagar
  for each row execute function public.set_atualizado_em();

-- RLS: acesso por membro da org (mesmo padrão do 0001)
do $$
declare t text;
begin
  foreach t in array array['contas_pagar','contrato_reajustes','avisos_enviados'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy %1$s_by_org on public.%1$s
         for all
         using (public.is_org_member(org_id))
         with check (public.is_org_member(org_id));', t);
  end loop;
end $$;
