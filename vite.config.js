import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// KitGest PWA — celular (operacional) + PC (retaguarda), mesmo Supabase.
// Publicado em GitHub Pages sob /kitgest/ (regimneves.github.io/kitgest/).
// Para rodar na raiz (Netlify/domínio próprio), troque BASE para '/'.
const BASE = '/kitgest/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'KitGest',
        short_name: 'KitGest',
        description: 'Gestão de kitnets',
        theme_color: '#1e293b',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        scope: BASE,
        start_url: BASE,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Cache do app-shell; a fila offline de dados (IndexedDB) vem depois.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}']
      }
    })
  ],
  server: { port: 5176 }
})
