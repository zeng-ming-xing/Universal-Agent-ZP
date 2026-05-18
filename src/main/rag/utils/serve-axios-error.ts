import axios from 'axios'

export function describeServeAxiosError(path: string, e: unknown): string {
  if (axios.isAxiosError(e)) {
    const status = e.response?.status
    const data = e.response?.data as
      | { error?: string; message?: string; extra?: { message?: string } }
      | undefined
    let detail = e.message
    if (data && typeof data === 'object') {
      if (typeof data.error === 'string') {
        detail = data.error
      } else if (typeof data.message === 'string') {
        detail = data.message
      } else if (data.extra && typeof data.extra.message === 'string') {
        detail = data.extra.message
      }
    }
    const st = status != null ? ` HTTP ${status}` : ''
    return `本地服务 POST ${path}${st}: ${detail}`
  }
  return e instanceof Error ? e.message : String(e)
}
