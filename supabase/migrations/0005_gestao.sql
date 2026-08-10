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
