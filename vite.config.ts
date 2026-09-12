import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
const ollama = {
  '/ollama': { target: 'http://localhost:11434', changeOrigin: true, rewrite: (path: string) => path.replace(/^\/ollama/, '') },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { proxy: ollama },
  preview: { proxy: ollama },
})
