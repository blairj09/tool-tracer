import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Keep built asset URLs relative so the app also works when proxied from
  // jamesblair.me/tools/tool-tracer/.
  base: './',
  plugins: [react()],
  server: {
    // Honour an assigned port (e.g. from the Claude Code preview runner); default 5173.
    port: Number(process.env.PORT) || 5173,
  },
})
