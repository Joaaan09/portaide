// Vista previa de HTML (DESIGN.md §7.2, ADR 2026-10-29 en decisiones.md).
//
// Un .html del proyecto se pinta en un <iframe sandbox> SIN allow-same-origin:
// su JS corre en un origen opaco y no puede tocar la API ni la cookie de sesión.
// La contrapartida es que sus peticiones (CSS/JS/imágenes relativos) son
// cross-site y no llevan la cookie → no pueden pasar por el gate de auth. Las
// autoriza un TOKEN de capacidad en la propia URL:
//
//   POST /api/fs/preview {path}   (con sesión)  → crea el token
//   GET  /api/preview/<token>/<ruta relativa>   (sin sesión, montado ANTES del gate)
//
// El token solo da lectura de la CARPETA del .html (y sus subcarpetas), caduca
// por inactividad, ignora todo lo que empiece por '.' (.env, .git…) y solo
// sirve extensiones web de una lista cerrada. Riesgo residual asumido: un .html
// malicioso puede leer su propio token y filtrarlo → lectura de esos assets
// durante el TTL (anotado en decisiones.md).
import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { MIME_BY_EXT, extOf } from './mime.js';
import { resolveSafe } from './paths.js';

export const previewRouter = Router();

// Caducidad por INACTIVIDAD: cada petición la renueva (una página que carga
// assets tarde sigue viva mientras se use).
const GRANT_TTL_MS = 20 * 60 * 1000;
// Tope de tokens vivos: el más antiguo se descarta (un solo usuario; sobra).
const MAX_GRANTS = 32;

// Flags del sandbox. Se aplican DOS veces (atributo del iframe en el cliente y
// cabecera CSP aquí): así la página sigue aislada aunque se abra suelta.
export const PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups';

// Lista cerrada de lo que sirve la vista previa (también hace de allowlist):
// lo que no esté aquí → 404. Sin .env/.ts/.yaml ni nada "de servidor".
const PREVIEW_MIME: Record<string, string> = {
  ...MIME_BY_EXT,
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  map: 'application/json; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

interface PreviewGrant {
  root: string; // carpeta absoluta del .html (dentro de FS_ROOT)
  expires: number;
}

const grants = new Map<string, PreviewGrant>();

function pruneGrants(now: number): void {
  for (const [token, g] of grants) if (g.expires <= now) grants.delete(token);
}

/** Crea un token de lectura sobre `root` (carpeta ya validada con resolveSafe). */
export function createPreviewGrant(root: string): string {
  const now = Date.now();
  pruneGrants(now);
  const token = crypto.randomBytes(24).toString('base64url');
  grants.set(token, { root, expires: now + GRANT_TTL_MS });
  // Map conserva el orden de inserción → el primero es el más antiguo.
  while (grants.size > MAX_GRANTS) grants.delete(grants.keys().next().value!);
  return token;
}

// --- GET /api/preview/<token>/<ruta> ---------------------------------------
// PÚBLICO (sin cookie): la autorización es el token. Cualquier fallo de token o
// de ruta responde 404 genérico (no da pistas de qué existe).
previewRouter.get('/:token/*', (req, res) => {
  const notFound = () => res.status(404).type('text/plain').send('not found');

  const now = Date.now();
  const grant = grants.get(req.params.token ?? '');
  if (!grant || grant.expires <= now) {
    if (grant) grants.delete(req.params.token!);
    notFound();
    return;
  }

  // Segmentos de la ruta relativa, decodificados uno a uno. Fuera: vacíos,
  // '.'/'..' y cualquier dotfile/dotdir (cubren traversal y .env/.git a la vez).
  const raw = (req.params as Record<string, string>)[0] ?? '';
  let segments: string[];
  try {
    segments = raw.split('/').map((s) => decodeURIComponent(s));
  } catch {
    notFound();
    return;
  }
  if (segments.length === 0 || segments.some((s) => s === '' || s.startsWith('.') || s.includes('\0'))) {
    notFound();
    return;
  }

  const abs = path.resolve(grant.root, ...segments);
  const mime = PREVIEW_MIME[extOf(abs)];
  if (!mime || !abs.startsWith(grant.root + path.sep) || !resolveSafe(abs)) {
    notFound();
    return;
  }

  grant.expires = now + GRANT_TTL_MS; // renovación por uso

  res.setHeader('Content-Type', mime);
  // Aislamiento aunque se abra fuera del iframe (origen opaco, sin cookie).
  res.setHeader('Content-Security-Policy', `sandbox ${PREVIEW_SANDBOX}`);
  // El documento vive en un origen opaco: sin CORS abierto no cargarían sus
  // <script type=module>, fuentes ni fetch() relativos. No expone nada que el
  // token no dé ya (y nunca va con credenciales).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer'); // el token no sale en Referer
  res.setHeader('Cache-Control', 'no-store');
  // sendFile: streaming + Range (vídeo/audio en iOS lo exigen). Content-Type ya
  // fijado arriba → send respeta el nuestro. Con `root`, send vuelve a impedir
  // salir de la carpeta y solo mira dotfiles en la parte RELATIVA de la ruta.
  const opts = { root: grant.root, dotfiles: 'deny' as const, cacheControl: false, lastModified: false, etag: false };
  res.sendFile(segments.join('/'), opts, (err) => {
    if (err && !res.headersSent) notFound();
  });
});
