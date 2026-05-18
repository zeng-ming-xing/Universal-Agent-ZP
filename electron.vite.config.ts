import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/** mysql-service 端口，优先读环境变量 */
const MYSQL_SERVICE_PORT = process.env.AGENT_MYSQL_SERVICE_PORT ?? '37123'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'es'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'es'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    server: {
      proxy: {
        '/mysql-api': {
          target: `http://127.0.0.1:${MYSQL_SERVICE_PORT}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/mysql-api/, '')
        }
      }
    }
  }
})
