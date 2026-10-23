// API de Source Control (server/src/git). Helpers tipados sobre /api/git.
// El `path` que se manda es SIEMPRE el workspace activo (ruta absoluta dentro
// de FS_ROOT); el backend resuelve por su cuenta la raíz real del repositorio.
import { api } from './client'

/** Letra de estado de un archivo: 'M' modificado, 'A' añadido, 'D' borrado,
 *  'R' renombrado, 'C' copiado, 'T' cambio de tipo, '?' sin seguimiento,
 *  '!' conflicto. `null` = sin cambio en esa columna. */
export type GitStatusLetter = string | null

export interface GitFile {
  /** Ruta relativa a la raíz del repo. */
  path: string
  /** Ruta original si es un renombrado. */
  origPath?: string
  /** Estado en el commit preparado (staged). */
  index: GitStatusLetter
  /** Estado en el árbol de trabajo (sin preparar). */
  work: GitStatusLetter
}

/** Repo detectado: estado completo. */
export interface GitRepoStatus {
  repo: true
  /** true si el servidor tiene GITHUB_TOKEN (sin él no hay push/pull). */
  tokenPresent: boolean
  root: string
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  /** Repositorio sin ningún commit todavía. */
  unborn: boolean
  files: GitFile[]
}

/** La carpeta no está dentro de ningún repositorio git. */
export interface GitNoRepo {
  repo: false
  tokenPresent: boolean
}

export type GitStatus = GitRepoStatus | GitNoRepo

export interface GitCommitResult {
  hash: string
  summary: string
  status: GitRepoStatus
}

export interface GitSyncResult {
  output: string
  status: GitRepoStatus
}

export const gitStatus = (path: string): Promise<GitStatus> =>
  api.get<GitStatus>(`/git/status?path=${encodeURIComponent(path)}`)

export const gitBranches = (path: string): Promise<{ current: string | null; all: string[] }> =>
  api.get<{ current: string | null; all: string[] }>(`/git/branches?path=${encodeURIComponent(path)}`)

/** Prepara archivos para el commit. Sin `files`, prepara todo. */
export const gitStage = (path: string, files?: string[]): Promise<GitRepoStatus> =>
  api.post<GitRepoStatus>('/git/stage', files ? { path, files } : { path })

/** Quita archivos del commit preparado. Sin `files`, quita todo. */
export const gitUnstage = (path: string, files?: string[]): Promise<GitRepoStatus> =>
  api.post<GitRepoStatus>('/git/unstage', files ? { path, files } : { path })

export const gitCommit = (path: string, message: string): Promise<GitCommitResult> =>
  api.post<GitCommitResult>('/git/commit', { path, message })

/** Refresca ahead/behind contra el remoto sin tocar el árbol de trabajo. */
export const gitFetch = (path: string): Promise<GitRepoStatus> =>
  api.post<GitRepoStatus>('/git/fetch', { path })

export const gitPull = (path: string): Promise<GitSyncResult> =>
  api.post<GitSyncResult>('/git/pull', { path })

export const gitPush = (path: string): Promise<GitSyncResult> =>
  api.post<GitSyncResult>('/git/push', { path })

export const gitCheckout = (path: string, branch: string, create = false): Promise<GitRepoStatus> =>
  api.post<GitRepoStatus>('/git/checkout', { path, branch, create })
