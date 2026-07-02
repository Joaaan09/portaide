# Estado — checkpoint de la última sesión

> Léeme al empezar. Actualízame al terminar cada sesión.

**Última actualización:** 2026-07-02 (5ª sesión)

**5ª sesión — persistencia migrada de MongoDB a SQLite** (`better-sqlite3`, embebido): ya no hay
contenedor de BD. Detalle abajo en "Deploy" y en `log.md`/`decisiones.md`.

## Dónde estamos

**Fase 3 IMPLEMENTADA Y DESPLEGADA.** PortaIDE ya es funcional de verdad (NO mock): conectada al VPS,
con login, terminal real (con `claude`/`clauded`), filesystem, editor y **chat con Claude real
(aprobaciones Approve/Reject reales)**. Desplegada con `docker compose up -d --build` y verificada de
punta a punta (SPA + health + **login OK** por la cadena nginx→backend). Rama de trabajo: `staging`.

Hecho en esta sesión (commits `ffbe7a4`…`76306ff` + deploy):

- **Auth** (bloqueante §11): login email+contraseña de UN usuario por `.env` (bcryptjs + JWT en cookie
  httpOnly, rate-limit). Gate en TODO `/api` y en el upgrade de los 3 WS. Verificado: 401 sin sesión en
  todo el `/api`, cookie `HttpOnly`.
- **Terminal real**: `node-pty` por `/ws/terminal`, xterm con pestañas, barra de teclas especiales,
  tema por tokens. `claude`/`clauded`/git/bash presentes en la imagen (verificado dentro del contenedor).
- **FS + Files + Editor**: `/api/fs` con guard anti path-traversal; Workspace estilo "Open Folder";
  vista Files (árbol lazy + selector de carpeta); Editor CodeMirror 6 (guardar Ctrl/Cmd+S, barra de
  símbolos, tema por tokens).
- **Chat = Claude real**: `@anthropic-ai/claude-agent-sdk` + `canUseTool` → **Approve/Reject reales**
  por `/ws/chat`; streaming (thinking/text/tool-cards), selector de modelo y permission mode; **mock
  ELIMINADO**. Smoke verde: Write aprobado crea archivo, denegado no lo crea.
- **Docker**: imagen backend `node:20-slim` (glibc, compat con claude-code y node-pty), toolchain para
  node-pty, `claude` global + wrapper `clauded`, git/bash, `HOME=/home/kuoyii`, corre como uid 1000;
  monta `/home/kuoyii/servers` y `~/.claude`. Compose pasa SESSION_SECRET/AUTH_*/FS_ROOT.
- **Deploy**: **persistencia migrada de Mongo a SQLite** (`better-sqlite3`, embebido; fichero en el
  volumen `portaide_data:/app/data`). Ya no hay servicio `mongo` en el compose. Pendiente `docker
  compose up -d --build` en el VPS (confirma la compilación nativa de better-sqlite3 en la imagen).

## Cómo entrar

- **URL**: la que configuraste en Nginx Proxy Manager → `portaide-frontend`. **Login**:
  `jcollvir@gmail.com` / `joan5599`.
- Secretos en `/home/kuoyii/servers/portaide/.env` (gitignored, chmod 600): SESSION_SECRET,
  AUTH_EMAIL, AUTH_PASSWORD. Puertos: backend 4100 (interno). Los `MONGO_*` del `.env` ya no se usan
  (borrables); el volumen `portaide_mongo_data` quedó huérfano y puede eliminarse tras desplegar.

## PENDIENTE — acción del usuario (no lo puedo hacer yo)

1. **Activar "Websockets Support"** en el proxy host de NPM para el dominio de PortaIDE. **Sin esto la
   terminal y el chat NO conectan** (el WS no pasa el borde). El resto (login, files, editor) sí.
2. **Cambiar la contraseña** `joan5599` (débil y viajó en claro por el chat): editar `AUTH_PASSWORD`
   en `.env` y `docker compose up -d --build`.
3. **QA visual** en el móvil: las 5 vistas y los 3 temas contra el mockup.

## Flecos conocidos (ver bugs.md) — no bloqueantes

- Files no muestra estado git por archivo (falta endpoint git-status).
- Al recargar, las pestañas de chat persisten pero no reanudan el hilo (no se guarda `claudeSessionId`).
- Editor: split-terminal aplazado a v2; undo se reinicia al cambiar de pestaña.
- FS: `resolveSafe` no resuelve symlinks (aceptable v1, un solo usuario).
- `DELETE /api/chat/sessions/:id` existe pero sin botón en la UI.

## Settings v1 (4ª sesión)

Vista Settings completada y **desplegada** (implementada por trabajo paralelo de otra sesión): Account +
Appearance (tema con swatches + tamaño de fuente cableado a CodeMirror) + System (`/api/system` real).
En esta sesión afiné **3 fixes sobre lo desplegado** (swatch de tema con fondo por tema §10, foco del
stepper en los límites, default de fuente con localStorage vacío) y puse **DESIGN §10 + decisiones.md** al
día (System sustituye a VPS Connection; Claude Code sigue en el composer del Chat). Typecheck verde y **DESPLEGADO** (frontend rebuild, 2026-07-02; commit `465922b`). Árbol limpio,
repo↔desplegado reconciliados. Verificado: pila healthy, SPA sirviendo.
⚠️ Hubo **dos sesiones sobre el mismo checkout pisándose** — NO correr dos sesiones de Claude sobre el
mismo repo a la vez (causó el "corte" y ejecutores pisándose en disco). Coordinar antes de paralelizar.

## Siguiente

Iterar según tu QA. Mejoras candidatas: reanudar chat tras reload, git-status en el explorer,
split-terminal, endurecer symlinks, 2FA/passkeys si se quiere subir el listón de seguridad.
