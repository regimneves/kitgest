# KitGest

Gestão de kitnets/quitinetes sublocadas — PWA (celular operacional + PC retaguarda) sobre Supabase.

Cobre o ciclo completo: **Casas & Quartos → Composição do aluguel (rateio de despesas) → Inquilinos → Contratos → Recebimentos (recibo PDF + PIX) → Vistoria (checklist + foto + assinatura + laudo PDF) → Acerto de saída → Manutenção → Relatórios** (rent roll, margem da sublocação, inadimplência).

## Stack
- Vite + React + React Router
- Supabase (Postgres + Auth + Storage, RLS por organização)
- PWA (vite-plugin-pwa), jsPDF, geração de PIX BR Code e QR no cliente

## Rodar local
```bash
npm install
npm run dev
```
Copie `.env.example` para `.env` se quiser sobrescrever a conexão Supabase (há um fallback embutido com a chave publishable, segura no cliente).

## Build / deploy
```bash
npm run build   # gera dist/ (+ 404.html e .nojekyll para SPA no GitHub Pages)
```
O deploy é automático: cada push na `main` dispara o workflow `.github/workflows/deploy.yml`, que publica em GitHub Pages. Base configurada em `vite.config.js` (`/kitgest/`).
