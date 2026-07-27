import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Vite bloquea por default cualquier dominio que no sea localhost. Sin esto,
    // al compartir el puerto (túnel de VS Code, ngrok, Cloudflare) el navegador
    // recibe "Blocked request. This host is not allowed".
    //
    // Solo hacen falta los dominios de los túneles: el backend NO se expone
    // aparte. El frontend pide rutas relativas (/api/...) y el proxy de abajo
    // las reenvía desde ESTA máquina a 127.0.0.1:8000, así que compartiendo
    // únicamente el 5173 va todo el sistema, backend incluido.
    allowedHosts: [
      '.devtunnels.ms',        // Port Forwarding de VS Code
      '.ngrok-free.app',
      '.ngrok.io',
      '.trycloudflare.com',
    ],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
