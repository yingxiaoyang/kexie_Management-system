import { buildApiUrl } from '../config/api'

const TOKEN_KEY = 'kexie_token'
const USER_KEY = 'kexie_user'

function authHeaders() {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function handleUnauthorized() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  if (window.location.pathname !== '/login') {
    window.location.assign(`/login?redirect=${encodeURIComponent(window.location.pathname)}`)
  }
}

export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, headers = {}, signal } = options
  const isFormData = body instanceof FormData
  let response
  try {
    response = await fetch(buildApiUrl(path), {
      method,
      signal,
      headers: {
        ...authHeaders(),
        ...(isFormData ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    })
  } catch {
    const error = new Error('无法连接后端服务，请确认后端和数据库已启动')
    error.code = 'NETWORK_ERROR'
    throw error
  }

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok || payload?.success === false) {
    if (response.status === 401) handleUnauthorized()
    const error = new Error(payload?.message || `请求失败（${response.status}）`)
    error.code = payload?.code || 'HTTP_ERROR'
    error.status = response.status
    throw error
  }
  return payload
}

export async function downloadFile(path, fallbackName = 'download') {
  let response
  try {
    response = await fetch(buildApiUrl(path), { headers: authHeaders() })
  } catch {
    throw new Error('下载失败，请确认后端服务已启动')
  }
  if (!response.ok) {
    if (response.status === 401) handleUnauthorized()
    let message = '下载失败'
    try {
      const payload = await response.json()
      message = payload.message || message
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(message)
  }
  const disposition = response.headers.get('content-disposition') || ''
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  const fileName = encodedName ? decodeURIComponent(encodedName) : plainName || fallbackName
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
