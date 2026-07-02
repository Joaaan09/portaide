// Wrapper de fetch para la API de PortaIDE. Envía siempre la cookie de sesión
// (credentials:'include', mismo origen tras el nginx del frontend) y normaliza
// los errores del backend ({error:'...'}) a ApiError con status + code.

const BASE = '/api'

/** Error de una respuesta no-2xx. `code` es el `error` que devuelve el backend. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** Extrae el código de error del cuerpo JSON del backend, con fallback. */
function extractCode(data: unknown): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const code = (data as Record<string, unknown>).error
    if (typeof code === 'string') return code
  }
  return 'request_failed'
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  // Cuerpo puede venir vacío (p.ej. algún 204); parsea con tolerancia.
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, extractCode(data))
  }
  return data as T
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body),
}
