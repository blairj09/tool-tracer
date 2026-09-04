import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Honour an assigned port (e.g. from the Claude Code preview runner); default 5173.
    port: Number(process.env.PORT) || 5173,
  },
})
