/**
 * Base URL for HTTP calls to the Express proxy.
 *
 * In local dev, leave `VITE_API_URL` **unset** so requests stay same-origin
 * (`http://localhost:5173/api/...`) and Vite forwards `/api` to the proxy.
 * If you set `VITE_API_URL=http://localhost:3001`, the browser calls port 3001
 * directly and the response fails CORS unless the server adds CORS headers.
 */
export function getApiBaseUrl() {
  const raw = import.meta.env.VITE_API_URL
  if (typeof raw === 'string' && raw.trim()) {
    return raw.replace(/\/$/, '')
  }
  return ''
}

/** @param {string} path e.g. `/api/context` */
export function apiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`
  const base = getApiBaseUrl()
  return base ? `${base}${p}` : p
}
