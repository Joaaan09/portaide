// Git API (DESIGN.md §8.1) — lo que consume el panel Source Control de Files.
// Se monta DEBAJO del gate de auth en app.ts → todo requiere sesión.
//
// Alcance deliberado (ADR 2026-08-04): status, preparar/quitar, commit, push,
// pull --ff-only, fetch y ramas. NADA destructivo: ni force, ni reset --hard,
// ni descartar cambios, ni resolución de conflictos. Eso se hace en la Terminal.
import { Router, type Response } from 'express';
import { env } from '../config/env.js';
import * as git from './service.js';
import { GitError } from './service.js';

export const gitRouter = Router();

/** Códigos de error → status HTTP. Todo lo no listado es 500. */
const ERROR_STATUS: Record<string, number> = {
  bad_path: 400,
  bad_files: 400,
  bad_branch: 400,
  empty_message: 400,
  message_too_long: 400,
  nothing_to_commit: 400,
  branch_exists: 409,
  branch_not_found: 404,
  repo_outside_root: 403,
  auth_required: 401,
  auth_forbidden: 403,
  identity_missing: 409,
  dirty_worktree: 409,
  diverged: 409,
  rejected: 409,
  no_upstream: 409,
  no_remote: 409,
  network_unreachable: 502,
  git_timeout: 504,
  git_not_installed: 500,
};

/** Responde un GitError con su detalle real (el panel lo enseña tal cual). */
function fail(res: Response, err: unknown): void {
  if (err instanceof GitError) {
    res.status(ERROR_STATUS[err.code] ?? 500).json({ error: err.code, detail: err.detail });
    return;
  }
  console.error('[git] error inesperado:', err);
  res.status(500).json({ error: 'git_error', detail: 'Error inesperado al ejecutar git.' });
}

/**
 * Resuelve el repo del `path` recibido y devuelve su estado.
 * Toda ruta mutable trabaja sobre la raíz que devuelve el propio git, no sobre
 * la que manda el cliente.
 */
async function requireStatus(p: unknown): Promise<git.GitStatus> {
  if (typeof p !== 'string') throw new GitError('bad_path', 'Falta la ruta del proyecto.');
  const st = await git.status(p);
  if (!st) throw new GitError('not_a_repo', 'Esta carpeta no es un repositorio git.');
  return st;
}

// --- GET /api/git/status?path= -------------------------------------------
// Estado del repo que contiene `path`. `repo:false` (200) si no hay repo: no es
// un error, el chip de rama simplemente no se pinta.
gitRouter.get('/status', async (req, res) => {
  try {
    const st = await git.status(String(req.query.path ?? ''));
    if (!st) {
      res.json({ repo: false, tokenPresent: env.githubTokenPresent });
      return;
    }
    res.json({ repo: true, tokenPresent: env.githubTokenPresent, ...st });
  } catch (err) {
    fail(res, err);
  }
});

// --- GET /api/git/branches?path= -----------------------------------------
gitRouter.get('/branches', async (req, res) => {
  try {
    const st = await requireStatus(String(req.query.path ?? ''));
    res.json(await git.branches(st.root));
  } catch (err) {
    fail(res, err);
  }
});

// --- POST /api/git/stage { path, files? } ---------------------------------
// Sin `files` → prepara todo (`git add -A`).
gitRouter.post('/stage', async (req, res) => {
  try {
    const st = await requireStatus(req.body?.path);
    if (req.body?.files === undefined) await git.stageAll(st.root);
    else await git.stage(st.root, req.body.files);
    res.json(await git.status(st.root));
  } catch (err) {
    fail(res, err);
  }
});

// --- POST /api/git/unstage { path, files? } -------------------------------
gitRouter.post('/unstage', async (req, res) => {
  try {
    const st = await requireStatus(req.body?.path);
    if (req.body?.files === undefined) await git.unstageAll(st.root, st.unborn);
    else await git.unstage(st.root, req.body.files, st.unborn);
    res.json(await git.status(st.root));
  } catch (err) {
    fail(res, err);
  }
});

// --- POST /api/git/commit { path, message } -------------------------------
gitRouter.post('/commit', async (req, res) => {
  try {
    const st = await requireStatus(req.body?.path);
    const result = await git.commit(st.root, req.body?.message);
    res.json({ ...result, status: await git.status(st.root) });
  } catch (err) {
    fail(res, err);
  }
});

// --- POST /api/git/fetch { path } -----------------------------------------
// Refresca ahead/behind sin traer nada al árbol de trabajo. Lo llama el panel al
// abrirse; si falla, el panel lo ignora en silencio (el estado local sigue bien).
gitRouter.post('/fetch', async (req, res) => {
  try {
    const st = await requireStatus(req.body?.path);
    await git.fetch(st.root);
    res.json(await git.status(st.root));
  } catch (err) {
    fail(res, err);
  }
});

// --- POST /api/git/pull { path } ------------------------------------------
gitRouter.post('/pull', async (req, res) => {
  try {
    const st = await requireStatus(req.body?.path);
    const output = await git.pull(st.root);
    res.json({ output, status: await git.status(st.root) });
  } catch (err) {
    fail(res, err);
  }
});

// --- POST /api/git/push { path } ------------------------------------------
gitRouter.post('/push', async (req, res) => {
  try {
    const st = await requireStatus(req.body?.path);
    if (!st.branch) throw new GitError('detached_head', 'No estás en ninguna rama.');
    const output = await git.push(st.root, st.branch, Boolean(st.upstream));
    res.json({ output, status: await git.status(st.root) });
  } catch (err) {
    fail(res, err);
  }
});

// --- POST /api/git/checkout { path, branch, create? } ---------------------
gitRouter.post('/checkout', async (req, res) => {
  try {
    const st = await requireStatus(req.body?.path);
    await git.checkout(st.root, req.body?.branch, req.body?.create === true);
    res.json(await git.status(st.root));
  } catch (err) {
    fail(res, err);
  }
});
