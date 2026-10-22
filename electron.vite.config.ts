import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Detached plain-Node process (ELECTRON_RUN_AS_NODE) that owns the PTYs across app restarts.
          'pty-daemon': resolve(__dirname, 'src/pty-daemon/index.ts'),
          // Fallback when the daemon is unavailable: an Electron utilityProcess (sessions end with the app).
          'pty-host': resolve(__dirname, 'src/pty-host/index.ts'),
          // Wavi's dispatch tools as a stdio MCP server each agent starts (ELECTRON_RUN_AS_NODE, PRD F21).
          'wavi-mcp': resolve(__dirname, 'src/main/dispatch/mcp-server.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(__dirname, 'src/renderer')
      }
    },
    plugins: [react()]
  }
})
