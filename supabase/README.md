# KitGest — Banco (Supabase)

Schema da v1 do KitGest (gestão de kitnets sublocadas, PWA + Supabase).
Multi-tenant desde o dia 1: **toda tabela tem `org_id` e RLS ligado**.

## Aplicar

Aplicar na ordem:

1. `migrations/0001_init.sql` — tabelas, funções, índices, triggers, RLS.
2. `migrations/0002_storage.sql` — buckets de arquivos + RLS.

Formas de aplicar:
- **SQL Editor do Supabase** (cola e roda cada arquivo), ou
- **CLI**: `supabase db push` (com os arquivos em `supabase/migrations/`), ou
- **MCP** (`apply_migration`) quando for para um projeto real.

> RLS é testado **pelo app** (usuário autenticado). O SQL Editor roda como
> `service_role` e **ignora RLS** — não serve para validar as políticas.

## Modelo

```
orgs ─┬─ org_membros (auth.users)          ← tenant + quem acessa
      ├─ casas ──── quartos ─── quarto_rateio (composição do aluguel/competência)
      │                └─ contratos ─── inquilinos
      │                       ├─ recebimentos (recibo + comprovante)
      │                       ├─ vistorias ─── vistoria_itens (checklist + fotos)
      │                       └─ acertos_saida ─── acerto_itens (dano/pendência/limpeza/chave/outro)
      ├─ despesas_casa (energia/água/gás/internet/iptu/limpeza/seguro/outro → rateio)
      └─ manutencao
```

### Decisões embutidas no schema
- **Branding na `orgs`** (`nome`, `cor_primaria`, `logo_url`, `pix_*`): em branco;
  o cliente preenche na **tela de configuração**.
- **Tudo sublocado + mensal**: `casas.tipo` default `sublocada`;
  `contratos.periodicidade` default `mensal`. `diaria/semanal/varios_meses` e
  `tipo='propria'` já estão nos CHECKs (**latentes, sem migração futura**).
- **Composição do aluguel por rateio**: `despesas_casa` + snapshot por competência
  em `quarto_rateio` (`detalhe` jsonb = quebra por despesa → rastreável p/ reajuste).
  `quartos.aluguel_base` + `quartos.valor_final` (base + rateio embutido).
- **Encargos inclusos** no aluguel (v1): `quartos.encargos_inclusos`.
  Medição individual de água/luz é fase futura — entra numa tabela nova,
  sem tocar as existentes.
- **Acerto de saída flexível**: `acertos_saida` (caução − descontos = a devolver)
  + `acerto_itens` (qualquer nº de linhas, tipos dano/pendência/limpeza/chave/outro).
- **Recibos numerados** por org: `proximo_recibo(org_id)` (atômico).

## Funções (RPC)
- `bootstrap_org(nome text) → uuid` — cria a org na 1ª config e vincula o
  usuário logado como `dono`. **É assim que o app cria a conta.**
- `proximo_recibo(org_id uuid) → int` — próximo nº de recibo (recebimentos/acertos).
- `is_org_member(org_id uuid) → bool` — usada pelas políticas de RLS.

## Storage (0002)
Buckets: `logos` (público), `comprovantes`, `vistoria-fotos`, `assinaturas`,
`laudos` (privados). **Caminho: `<bucket>/<org_id>/<arquivo>`** — a 1ª pasta é o
`org_id`, então o RLS reaproveita `is_org_member()`. Comprimir fotos (~1280px)
no cliente antes do upload.

## Pendências / próximos passos
- Conectar o PWA (client Supabase) e trocar o snapshot dos protótipos por dados reais.
- Ligar `wa.me` (telefone do inquilino) e geração de PIX BR Code + recibo (jsPDF).
- Fila offline (IndexedDB) para o operacional do celular.
