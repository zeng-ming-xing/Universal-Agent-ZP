import axios from 'axios'

/**
 * 共享的 axios 实例 —— 指向本地 mysql-service（Express + Prisma）。
 *
 * dev 模式：通过 Vite proxy 将 /mysql-api 转发到 http://127.0.0.1:37123，
 *          浏览器视为同源，彻底避开 CORS。
 * prod 模式：直接请求 http://127.0.0.1:${port}，mysql-service 自身已启用 CORS。
 */
const port = import.meta.env.VITE_MYSQL_SERVICE_PORT ?? '37123'
const baseURL = import.meta.env.DEV
  ? '/mysql-api'
  : `http://127.0.0.1:${port}`

export const http = axios.create({
  baseURL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
})
