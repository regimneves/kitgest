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
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
        // Navegação offline cai no app-shell (SPA).
        navigateFallback: BASE + 'index.html',
        navigateFallbackDenylist: [/\/rest\//, /\/auth\//, /\/storage\//],
        runtimeCaching: [
          {
            // LEITURA de dados (GET) → cache p/ ver offline (NetworkFirst).
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'kitgest-dados',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 300, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          // GRAVAÇÕES → fila offline (BackgroundSync): reenvia ao reconectar.
          {
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkOnly',
            method: 'POST',
            options: { backgroundSync: { name: 'kitgest-fila', options: { maxRetentionTime: 24 * 60 } } }
          },
          {
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkOnly',
            method: 'PATCH',
            options: { backgroundSync: { name: 'kitgest-fila', options: { maxRetentionTime: 24 * 60 } } }
          },
          {
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkOnly',
            method: 'DELETE',
            options: { backgroundSync: { name: 'kitgest-fila', options: { maxRetentionTime: 24 * 60 } } }
          },
          {
            // Fotos/laudos do Storage (GET) → cache p/ miniaturas offline.
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/.*/i,
            handler: 'CacheFirst',
            method: 'GET',
            options: {
              cacheName: 'kitgest-arquivos',
              expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  server: { port: 5176 }
})
