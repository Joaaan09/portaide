// Puente con el binario `git` (CLAUDE.md §2). No hay librería de por medio: se
// invoca `git` con execFile (SIN shell) y se parsea su salida porcelain, que es
// una interfaz estable y pensada justo para esto. Motivos en decisiones.md
// (ADR 2026-08-04 "Source Control sin librería de git").
//
// Seguridad (CLAUDE.md §11):
// - Toda ruta pasa por resolveDirSafe/resolveSafe → nunca se sale de FS_ROOT.
// - execFile sin shell + `--` antes de las rutas → nada de inyección por nombre
//   de archivo ni argumentos que se cuelen como flags.
// - El token de GitHub NUNCA viaja en argv (sería visible en `ps aux`): se pasa
//   por env al subproceso y lo lee un credential helper efímero.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { env } from '../config/env.js';
import { FS_ROOT, resolveDirSafe } from '../fs/paths.js';

/** Timeout de las operaciones locales (status, add, commit…). */
const LOCAL_TIMEOUT_MS = 20_000;
/** Timeout de las operaciones de red (fetch, pull, push): más generoso. */
const NET_TIMEOUT_MS = 120_000;
/** Tope de salida capturada por invocación (evita comerse la RAM con un repo enorme). */
const MAX_BUFFER = 8 * 1024 * 1024;
/** Tope del mensaje de commit (defensivo). */
const MAX_MESSAGE_LEN = 5_000;

/** Variable donde viaja el token hasta el credential helper (no es una env de git). */
const TOKEN_ENV = 'PORTAIDE_GIT_TOKEN';

/**
 * Credential helper efímero para HTTPS: git lo ejecuta cuando el remoto pide
 * credenciales y espera `username=`/`password=` por stdout. El token se lee de
 * la env del subproceso, así que no aparece en la línea de comandos ni queda
 * escrito en `.git/config` (a diferencia de meterlo en la URL del remoto).
 */
const CREDENTIAL_HELPER =
  '!f() { test "$1" = get && echo username=x-access-token && echo "password=$' + TOKEN_ENV + '"; }; f';

/** Error de una invocación de git con su salida real (se enseña al usuario). */
export class GitError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
    readonly exitCode: number | null = null
  ) {
    super(detail || code);
    this.name = 'GitError';
  }
}

interface RunOptions {
  /** true para operaciones de red: timeout largo + credencial del token. */
  network?: boolean;
  /** No lanzar en exit≠0; devolver el resultado igualmente. */
  allowFailure?: boolean;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Ejecuta `git` en `cwd`. Sin shell: `args` va tal cual al proceso.
 * Devuelve stdout/stderr; lanza GitError si el exit code no es 0 (salvo
 * `allowFailure`).
 */
function run(cwd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  // Env mínima y explícita: sin heredar prompts interactivos ni editores.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0', // jamás bloquear pidiendo usuario/contraseña
    GIT_ASKPASS: '', // ni abrir un askpass gráfico
    GIT_EDITOR: 'true', // ningún comando debe abrir un editor
    GIT_PAGER: 'cat',
    LC_ALL: 'C', // mensajes de error en inglés, estables para detectar casos
  };

  const prefix: string[] = [];
  if (opts.network && env.githubToken) {
    childEnv[TOKEN_ENV] = env.githubToken;
    prefix.push('-c', `credential.helper=${CREDENTIAL_HELPER}`);
    // Ignora helpers heredados del sistema/usuario que pudieran pedir input.
    prefix.unshift('-c', 'credential.helper=');
  }
  // Identidad del autor si está configurada por env (el backend puede correr con
  // un HOME sin ~/.gitconfig). Si no, se usa la del sistema.
  if (env.gitAuthorName) prefix.push('-c', `user.name=${env.gitAuthorName}`);
  if (env.gitAuthorEmail) prefix.push('-c', `user.email=${env.gitAuthorEmail}`);

  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...prefix, ...args],
      {
        cwd,
        env: childEnv,
        timeout: opts.network ? NET_TIMEOUT_MS : LOCAL_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const out = String(stdout ?? '');
        const errOut = String(stderr ?? '');
        if (!err) {
          resolve({ stdout: out, stderr: errOut, exitCode: 0 });
          return;
        }
        const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
        if (e.code === 'ENOENT') {
          reject(new GitError('git_not_installed', 'El binario `git` no está disponible en el servidor.'));
          return;
        }
        if (e.killed) {
          reject(new GitError('git_timeout', 'La operación de git ha excedido el tiempo límite.'));
          return;
        }
        const exitCode = typeof e.code === 'number' ? e.code : 1;
        if (opts.allowFailure) {
          resolve({ stdout: out, stderr: errOut, exitCode });
          return;
        }
        reject(new GitError('git_failed', (errOut || out).trim(), exitCode));
      }
    );
  });
}

// --- Serialización por repositorio ---------------------------------------
// Dos operaciones de git a la vez sobre el mismo repo pueden chocar por el
// index.lock (o dejarlo a medias). Se encolan por raíz de repo.
const locks = new Map<string, Promise<unknown>>();

function withRepoLock<T>(repoRoot: string, task: () => Promise<T>): Promise<T> {
  const prev = locks.get(repoRoot) ?? Promise.resolve();
  const next = prev.then(task, task);
  // La cadena no debe romperse por un fallo del turno anterior.
  locks.set(
    repoRoot,
    next.catch(() => undefined)
  );
  return next;
}

// --- Localización del repo -----------------------------------------------

/**
 * Resuelve la raíz del repositorio que contiene `p`.
 * Devuelve `null` si `p` no está en un repo. Lanza si la raíz cae FUERA de
 * FS_ROOT (un repo padre por encima del workspace no es navegable).
 */
export async function findRepoRoot(p: string): Promise<string | null> {
  const abs = resolveDirSafe(p);
  if (!abs) throw new GitError('bad_path', 'Ruta fuera del workspace o inexistente.');
  const res = await run(abs, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  if (res.exitCode !== 0) return null; // not a git repository
  const root = path.resolve(res.stdout.trim());
  if (!root) return null;
  if (root !== FS_ROOT && !root.startsWith(FS_ROOT + path.sep)) {
    throw new GitError('repo_outside_root', 'El repositorio queda fuera de la raíz navegable.');
  }
  return root;
}

// --- Status ---------------------------------------------------------------

/** Un archivo con cambios, tal y como lo pinta el panel. */
export interface GitFile {
  /** Ruta relativa a la raíz del repo (POSIX, tal cual la da git). */
  path: string;
  /** Ruta original en un renombrado. */
  origPath?: string;
  /** Letra del index (staged): 'M' | 'A' | 'D' | 'R' | 'C' | 'T', o null. */
  index: string | null;
  /** Letra del working tree (sin preparar): idem, '?' sin seguimiento, '!' conflicto. */
  work: string | null;
}

export interface GitStatus {
  /** Raíz del repositorio (absoluta). */
  root: string;
  /** Rama actual, o null si HEAD está desacoplado. */
  branch: string | null;
  /** Rama remota de seguimiento (`origin/main`), o null. */
  upstream: string | null;
  /** Commits por subir / por bajar respecto al upstream. */
  ahead: number;
  behind: number;
  /** true si el repo aún no tiene ningún commit. */
  unborn: boolean;
  files: GitFile[];
}

/** Normaliza un carácter de estado XY de porcelain v2 ('.' = sin cambio). */
function statusChar(c: string | undefined): string | null {
  if (!c || c === '.' || c === ' ') return null;
  return c;
}

/**
 * Parsea `git status --porcelain=v2 --branch -z`.
 * Formato (registros separados por NUL):
 *   `# branch.head main`, `# branch.ab +1 -2`, …
 *   `1 XY sub mH mI mW hH hI path`          (ordinario)
 *   `2 XY sub mH mI mW hH hI Xscore path` + NUL + `origPath`  (renombrado)
 *   `u XY sub m1 m2 m3 mW h1 h2 h3 path`    (sin fusionar)
 *   `? path`  ·  `! path`
 */
function parseStatus(raw: string, root: string): GitStatus {
  const out: GitStatus = {
    root,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    unborn: false,
    files: [],
  };
  const records = raw.split('\0');
  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i];
    if (!rec) continue;
    if (rec.startsWith('# ')) {
      const [, key, ...rest] = rec.split(' ');
      const value = rest.join(' ');
      if (key === 'branch.head') out.branch = value === '(detached)' ? null : value;
      else if (key === 'branch.upstream') out.upstream = value;
      else if (key === 'branch.oid') out.unborn = value === '(initial)';
      else if (key === 'branch.ab') {
        const m = /^\+(-?\d+) -(-?\d+)$/.exec(value);
        if (m) {
          out.ahead = Number(m[1]);
          out.behind = Number(m[2]);
        }
      }
      continue;
    }
    const kind = rec[0];
    if (kind === '?' || kind === '!') {
      if (kind === '!') continue; // ignorados: no se pintan
      out.files.push({ path: rec.slice(2), index: null, work: '?' });
      continue;
    }
    if (kind === '1' || kind === '2') {
      const fields = rec.split(' ');
      const xy = fields[1] ?? '..';
      // En '1' la ruta empieza en el campo 8; en '2' hay un campo extra (Xscore).
      const pathStart = kind === '1' ? 8 : 9;
      const filePath = fields.slice(pathStart).join(' ');
      const entry: GitFile = {
        path: filePath,
        index: statusChar(xy[0]),
        work: statusChar(xy[1]),
      };
      if (kind === '2') {
        // El origen del renombrado va en el SIGUIENTE registro NUL.
        i += 1;
        const orig = records[i];
        if (orig) entry.origPath = orig;
      }
      out.files.push(entry);
      continue;
    }
    if (kind === 'u') {
      const fields = rec.split(' ');
      out.files.push({ path: fields.slice(10).join(' '), index: null, work: '!' });
    }
  }
  return out;
}

/** Estado completo del repo que contiene `p` (null si no hay repo). */
export async function status(p: string): Promise<GitStatus | null> {
  const root = await findRepoRoot(p);
  if (!root) return null;
  const res = await run(root, ['status', '--porcelain=v2', '--branch', '-z']);
  return parseStatus(res.stdout, root);
}

// --- Validación de entradas del cliente ----------------------------------

/**
 * Valida las rutas que manda el cliente para preparar/quitar del commit.
 * Deben ser relativas al repo, sin `..`, sin absolutas y sin empezar por `-`
 * (que git leería como flag; aun así siempre se pasa `--`).
 */
function assertRelPaths(files: unknown, repoRoot: string): string[] {
  if (!Array.isArray(files) || files.length === 0) {
    throw new GitError('bad_files', 'Lista de archivos vacía o inválida.');
  }
  if (files.length > 1000) throw new GitError('bad_files', 'Demasiados archivos en una sola operación.');
  return files.map((f) => {
    if (typeof f !== 'string' || f.length === 0 || f.startsWith('-') || f.includes('\0')) {
      throw new GitError('bad_files', 'Ruta de archivo inválida.');
    }
    const abs = path.resolve(repoRoot, f);
    if (abs !== repoRoot && !abs.startsWith(repoRoot + path.sep)) {
      throw new GitError('bad_files', 'Ruta fuera del repositorio.');
    }
    return f;
  });
}

/** Nombres de rama admitidos (subconjunto conservador de git check-ref-format). */
const BRANCH_RE = /^(?!-)(?!\/)[A-Za-z0-9._\-/]{1,200}$/;

function assertBranch(name: unknown): string {
  if (typeof name !== 'string' || !BRANCH_RE.test(name) || name.includes('..') || name.endsWith('/')) {
    throw new GitError('bad_branch', 'Nombre de rama inválido.');
  }
  return name;
}

// --- Operaciones ----------------------------------------------------------

/** Prepara archivos para el commit (`git add -- <paths>`). */
export async function stage(repoRoot: string, files: unknown): Promise<void> {
  const rel = assertRelPaths(files, repoRoot);
  await withRepoLock(repoRoot, () => run(repoRoot, ['add', '--', ...rel]));
}

/** Prepara TODO lo que hay en el árbol (`git add -A`). */
export async function stageAll(repoRoot: string): Promise<void> {
  await withRepoLock(repoRoot, () => run(repoRoot, ['add', '-A']));
}

/**
 * Quita archivos del commit preparado. En un repo sin commits todavía no existe
 * HEAD, así que se usa `rm --cached` en vez de `restore --staged`.
 */
export async function unstage(repoRoot: string, files: unknown, unborn: boolean): Promise<void> {
  const rel = assertRelPaths(files, repoRoot);
  await withRepoLock(repoRoot, () =>
    unborn
      ? run(repoRoot, ['rm', '--cached', '-r', '--', ...rel])
      : run(repoRoot, ['restore', '--staged', '--', ...rel])
  );
}

/** Quita del commit todo lo preparado. */
export async function unstageAll(repoRoot: string, unborn: boolean): Promise<void> {
  await withRepoLock(repoRoot, () =>
    unborn ? run(repoRoot, ['rm', '--cached', '-r', '--', '.']) : run(repoRoot, ['reset', '--quiet', 'HEAD', '--'])
  );
}

export interface CommitResult {
  /** Hash corto del commit creado. */
  hash: string;
  summary: string;
}

/** Crea el commit con lo que haya preparado. */
export async function commit(repoRoot: string, message: unknown): Promise<CommitResult> {
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new GitError('empty_message', 'El mensaje del commit no puede estar vacío.');
  }
  if (message.length > MAX_MESSAGE_LEN) {
    throw new GitError('message_too_long', 'El mensaje del commit es demasiado largo.');
  }
  return withRepoLock(repoRoot, async () => {
    // `-m` con el mensaje como argumento: execFile no pasa por shell, así que
    // no hay interpolación posible por muy raro que sea el texto.
    const res = await run(repoRoot, ['commit', '-m', message.trim()], { allowFailure: true });
    if (res.exitCode !== 0) {
      const detail = (res.stderr || res.stdout).trim();
      if (/Please tell me who you are|empty ident name|unable to auto-detect email/i.test(detail)) {
        throw new GitError(
          'identity_missing',
          'Git no sabe con qué nombre firmar el commit. Configura GIT_AUTHOR_NAME y GIT_AUTHOR_EMAIL en el .env del servidor.'
        );
      }
      if (/nothing to commit|no changes added/i.test(res.stdout + detail)) {
        throw new GitError('nothing_to_commit', 'No hay nada preparado para guardar.');
      }
      throw new GitError('commit_failed', detail || res.stdout.trim(), res.exitCode);
    }
    const head = await run(repoRoot, ['log', '-1', '--pretty=format:%h %s']);
    const line = head.stdout.trim();
    const sp = line.indexOf(' ');
    return { hash: sp > 0 ? line.slice(0, sp) : line, summary: sp > 0 ? line.slice(sp + 1) : '' };
  });
}

/** Traduce fallos de red/credenciales a códigos que la UI sabe explicar. */
function networkError(detail: string, exitCode: number, fallback: string): GitError {
  if (/could not read Username|Authentication failed|terminal prompts disabled|invalid username or (token|password)/i.test(detail)) {
    return new GitError(
      'auth_required',
      env.githubToken
        ? 'GitHub ha rechazado el token. Comprueba que no ha caducado y que da permiso de escritura sobre este repositorio.'
        : 'Falta el token de GitHub: añade GITHUB_TOKEN al .env del servidor y reinícialo.',
      exitCode
    );
  }
  if (/Permission to .* denied|403/i.test(detail)) {
    return new GitError('auth_forbidden', 'El token no tiene permiso de escritura sobre este repositorio.', exitCode);
  }
  if (/Could not resolve host|unable to access|Connection timed out|network is unreachable/i.test(detail)) {
    return new GitError('network_unreachable', 'No se ha podido contactar con el remoto.', exitCode);
  }
  return new GitError(fallback, detail, exitCode);
}

/** `git fetch` del remoto de seguimiento (para que ahead/behind sean reales). */
export async function fetch(repoRoot: string): Promise<void> {
  await withRepoLock(repoRoot, async () => {
    const res = await run(repoRoot, ['fetch', '--prune'], { network: true, allowFailure: true });
    if (res.exitCode !== 0) {
      const detail = (res.stderr || res.stdout).trim();
      if (/No remote repository specified|does not appear to be a git repo/i.test(detail)) {
        throw new GitError('no_remote', 'Este repositorio no tiene remoto configurado.', res.exitCode);
      }
      throw networkError(detail, res.exitCode, 'fetch_failed');
    }
  });
}

/**
 * `git pull --ff-only`: trae lo del remoto solo si se puede avanzar en línea
 * recta. Deliberadamente NO se fusiona ni se rebasa (DESIGN §8.1: resolver
 * conflictos no es tarea de una pantalla de móvil).
 */
export async function pull(repoRoot: string): Promise<string> {
  return withRepoLock(repoRoot, async () => {
    const res = await run(repoRoot, ['pull', '--ff-only'], { network: true, allowFailure: true });
    const detail = (res.stderr || res.stdout).trim();
    if (res.exitCode !== 0) {
      if (/Not possible to fast-forward|diverging|non-fast-forward/i.test(detail)) {
        throw new GitError(
          'diverged',
          'Tu rama y la del servidor han avanzado por caminos distintos: hay que fusionarlas a mano desde la Terminal.',
          res.exitCode
        );
      }
      if (/no tracking information|There is no tracking information/i.test(detail)) {
        throw new GitError('no_upstream', 'Esta rama todavía no está enlazada con el servidor. Súbela primero.', res.exitCode);
      }
      if (/local changes .* would be overwritten|Please commit your changes/i.test(detail)) {
        throw new GitError(
          'dirty_worktree',
          'Tienes cambios sin guardar que se perderían al bajar. Guárdalos (commit) primero.',
          res.exitCode
        );
      }
      throw networkError(detail, res.exitCode, 'pull_failed');
    }
    return res.stdout.trim() || detail;
  });
}

/**
 * `git push`. Si la rama no tiene upstream, lo crea contra `origin`
 * (equivalente a `push -u origin <rama>`), que es lo que espera cualquiera al
 * pulsar "Subir" en una rama nueva.
 */
export async function push(repoRoot: string, branch: string | null, hasUpstream: boolean): Promise<string> {
  return withRepoLock(repoRoot, async () => {
    const args = hasUpstream ? ['push'] : ['push', '-u', 'origin', assertBranch(branch)];
    const res = await run(repoRoot, args, { network: true, allowFailure: true });
    const detail = (res.stderr || res.stdout).trim();
    if (res.exitCode !== 0) {
      if (/non-fast-forward|fetch first|Updates were rejected/i.test(detail)) {
        throw new GitError(
          'rejected',
          'El servidor tiene commits que tú no tienes. Pulsa "Bajar" antes de subir.',
          res.exitCode
        );
      }
      if (/'origin' does not appear|No such remote|No configured push destination/i.test(detail)) {
        throw new GitError('no_remote', 'Este repositorio no tiene remoto `origin` configurado.', res.exitCode);
      }
      throw networkError(detail, res.exitCode, 'push_failed');
    }
    return detail || 'ok';
  });
}

/** Ramas locales del repo + cuál es la actual. */
export async function branches(repoRoot: string): Promise<{ current: string | null; all: string[] }> {
  const res = await run(repoRoot, ['branch', '--format=%(refname:short)%09%(HEAD)'], { allowFailure: true });
  if (res.exitCode !== 0) return { current: null, all: [] }; // repo sin commits
  let current: string | null = null;
  const all: string[] = [];
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [name, head] = line.split('\t');
    if (!name) continue;
    all.push(name);
    if (head === '*') current = name;
  }
  return { current, all };
}

/** Cambia de rama (o crea una nueva desde la actual con `create`). */
export async function checkout(repoRoot: string, branch: unknown, create: boolean): Promise<void> {
  const name = assertBranch(branch);
  await withRepoLock(repoRoot, async () => {
    const res = await run(repoRoot, create ? ['checkout', '-b', name] : ['checkout', name], {
      allowFailure: true,
    });
    if (res.exitCode !== 0) {
      const detail = (res.stderr || res.stdout).trim();
      if (/would be overwritten by checkout|local changes/i.test(detail)) {
        throw new GitError('dirty_worktree', 'Tienes cambios sin guardar que se perderían al cambiar de rama.', res.exitCode);
      }
      if (/already exists/i.test(detail)) {
        throw new GitError('branch_exists', 'Ya existe una rama con ese nombre.', res.exitCode);
      }
      if (/did not match any file|invalid reference/i.test(detail)) {
        throw new GitError('branch_not_found', 'Esa rama no existe.', res.exitCode);
      }
      throw new GitError('checkout_failed', detail, res.exitCode);
    }
  });
}
