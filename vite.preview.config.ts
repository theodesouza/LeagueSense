import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Servidor só do renderer, para pré-visualizar no navegador com o simulador da ponte (desenvolvimento). */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: { alias: { '@core': resolve(__dirname, 'src/core'), '@shared': resolve(__dirname, 'src/shared') } },
  server: { port: 5173, strictPort: true, host: '127.0.0.1' }
})
