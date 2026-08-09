// Pós-build: GitHub Pages não tem fallback de SPA; servir 404.html = index.html
// faz qualquer deep link (ex.: /kitgest/casas) carregar o app, e o react-router
// assume a rota. .nojekyll garante que o Pages sirva todos os arquivos como estão.
import { copyFileSync, writeFileSync } from 'node:fs'

copyFileSync('dist/index.html', 'dist/404.html')
writeFileSync('dist/.nojekyll', '')
console.log('postbuild: 404.html + .nojekyll gerados')
