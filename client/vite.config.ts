import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // El backend de PortaIDE corre en el propio VPS, puerto 4100 (ver CLAUDE.md §2)
    proxy: {
      '/api': 'http://localhost:4100',
      '/ws': {
        target: 'ws://localhost:4100',
        ws: true,
      },
    },
  },
})
