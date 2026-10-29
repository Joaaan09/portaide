// Wrapper de fetch para la API de PortaIDE. Envía siempre la cookie de sesión
// (credentials:'include', mismo origen tras el nginx del frontend) y normaliza
// los errores del backend ({error:'...'}) a ApiError con status + code.

const BASE = '/api'

/** Error de una respuesta no-2xx. `code` es el `error` que devuelve el backend. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** Mensaje humano opcional del backend (`detail`). La API de git lo usa para
   *  enseñar la salida real de git en vez de un código seco (DESIGN §8.1). */
  readonly detail?: string
  constructor(status: number, code: string, detail?: string) {
    super(detail || code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
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
    const detail =
      data && typeof data === 'object' && typeof (data as Record<string, unknown>).detail === 'string'
        ? ((data as Record<string, unknown>).detail as string)
        : undefined
    throw new ApiError(res.status, extractCode(data), detail)
  }
  return data as T
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body),
  del: <T>(path: string): Promise<T> => request<T>('DELETE', path),
}

// --- FS API (server/src/fs) ------------------------------------------------
// Helpers tipados sobre /api/fs. El `path` siempre es absoluto (dentro de
// FS_ROOT); el backend valida con resolveSafe (guard anti path-traversal).

/** Raíz navegable + workspace por defecto (GET /api/fs/context). */
export interface FsContext {
  root: string
  defaultWorkspace: string
}

/** Entrada de una carpeta. `size` solo viene en archivos. */
export interface FsEntry {
  name: string
  type: 'dir' | 'file'
  size?: number
}

export interface FsListResult {
  path: string
  entries: FsEntry[]
}

export interface FsReadResult {
  path: string
  content: string
  truncated?: boolean
}

/** Codifica una ruta para meterla en el query string. */
const q = (path: string): string => encodeURIComponent(path)

/** Extensión en minúsculas de una ruta ('a/b.PDF' → 'pdf'; sin punto → ''). */
function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
}

/** Extensiones que tratamos como imagen previsualizable (vista Editor). */
const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'bmp',
  'ico',
  'heic',
  'heif',
])

/** true si la ruta apunta a un formato de imagen que sabemos previsualizar. */
export const isImagePath = (path: string): boolean => IMAGE_EXTS.has(extOf(path))

/** true si la ruta es un PDF (se pinta con el visor de pdf.js, no se lee como texto). */
export const isPdfPath = (path: string): boolean => extOf(path) === 'pdf'

/** true si la ruta es HTML (texto editable + vista previa en iframe sandbox). */
export const isHtmlPath = (path: string): boolean => {
  const ext = extOf(path)
  return ext === 'html' || ext === 'htm'
}

/** URL para servir un archivo CRUDO inline (p.ej. `<img src>`). Lleva la cookie
 *  de sesión por ser del mismo origen; el gate de auth del backend sigue vivo. */
export const fsRawUrl = (path: string): string => `${BASE}/fs/raw?path=${q(path)}`

/** URL de descarga (attachment): un archivo tal cual, una carpeta como .zip. */
export const fsDownloadUrl = (path: string): string => `${BASE}/fs/download?path=${q(path)}`

export const fsContext = (): Promise<FsContext> => api.get<FsContext>('/fs/context')

export const listDir = (path: string): Promise<FsListResult> =>
  api.get<FsListResult>(`/fs/list?path=${q(path)}`)

export const readFile = (path: string): Promise<FsReadResult> =>
  api.get<FsReadResult>(`/fs/read?path=${q(path)}`)

export const writeFile = (path: string, content: string): Promise<{ ok: boolean; bytes: number }> =>
  api.put<{ ok: boolean; bytes: number }>('/fs/write', { path, content })

/** Abre una vista previa de un .html: URL tokenizada (lectura de SU carpeta,
 *  caduca por inactividad) para cargarla en un <iframe sandbox>. */
export const openHtmlPreview = (path: string): Promise<{ url: string }> =>
  api.post<{ url: string }>('/fs/preview', { path })

export const mkdir = (path: string): Promise<{ ok: boolean }> =>
  api.post<{ ok: boolean }>('/fs/mkdir', { path })

export const renamePath = (from: string, to: string): Promise<{ ok: boolean }> =>
  api.post<{ ok: boolean }>('/fs/rename', { from, to })

export const deletePath = (path: string): Promise<{ ok: boolean }> =>
  api.del<{ ok: boolean }>(`/fs/delete?path=${q(path)}`)

// --- System API (server/src/system) ---------------------------------------
// Estado real del backend para el panel System de Settings.

export interface SystemInfo {
  backend: { uptimeSeconds: number; node: string }
  claude: { version: string | null }
  workspace: { fsRoot: string }
  database: { engine: string; ok: boolean }
}

export const getSystemInfo = (): Promise<SystemInfo> => api.get<SystemInfo>('/system')
