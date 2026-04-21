import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'local'
const buildStamp = new Date().toISOString().replace('T', ' ').slice(0, 16)
const buildId = `${buildStamp} · ${commitSha.slice(0, 7)}`

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  server: {
    proxy: {
      '/me': 'http://localhost:3000',
      '/admin': 'http://localhost:3000',
      '/auth': 'http://localhost:3000'
    }
  }
})
