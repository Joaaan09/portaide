# Estado — checkpoint de la última sesión

> Léeme al empezar. Actualízame al terminar cada sesión.

**Última actualización:** 2026-07-06 (retoma de la 7ª sesión)

**Nota 2026-07-06 (otra sesión en paralelo, Modo Directo) — Chat: cliente MIGRADO al SessionRuntime +
backend del historial del engine.**
1) **BUG ALTO RESUELTO:** `chatStore.ts` migrado al protocolo multiplexado (`attach`/`message`/`stop`/
   `permission`/`set_model`/`set_permission_mode` con `sessionId`; procesa `snapshot`/`event`/`status`;
   ensambla el `LogEvent[]` autoritativo del server con `reduceEvent`; attach a todas las pestañas +
   re-attach al reconectar). Fuera `user_message`/`loadThread`/`persistSession`. typecheck+build (client)
   VERDES + contrato cotejado con `ws.ts`/`runtime.ts`. **El chat ya conectaría** (antes no). Falta e2e tras deploy.
2) **Historial del engine (BACKEND, ya desbloqueado para UI):** `server/src/chat/engineHistory.ts` +
   `GET /api/chat/engine/sessions[?cwd]` y `.../:id` (lee `~/.claude/projects`, `.jsonl`→`LogEvent[]`,
   reanudable). Verificado con smoke sobre transcripts reales. **Falta la UI** del panel (ya NO bloqueada).
⚠️ Detectado **otro terminal editando `AppShell.tsx` en vivo** (fix del viewport/teclado, `useViewportHeight`)
— trabajo concurrente en el cliente. NO desplegado.

**7ª sesión 2026-07-03 — Navegación: retirada la isla flotante → drawer `☰` + barra inferior (IMPLEMENTADO, build verde; SIN desplegar).**
Se **elimina `NavIsland`** (isla dinámica flotante) y se sustituye por **dos modos de navegación
intercambiables en Settings → Appearance** (preferencia `navMode` en localStorage, default `drawer`):
1) **Drawer `☰` (por defecto)**: botón ☰ en la cabecera de cada vista → `NavDrawer` (panel lateral
   deslizante desde la izquierda, 5 destinos, scrim, focus-trap, `Esc`, foco inicial/devolución).
2) **Barra inferior (alternativa)**: `BottomBar` fija abajo con los 5 destinos (icono+label, activo en
   `--accent`, `aria-current`).
Clearance por modo con la var **`--nav-inset`** (0 en drawer → edge-to-edge real; `--bottombar-height`=56px
en bottombar) que sustituye al viejo `--fab-clear` en las 7 superficies. Nuevos: `NavModeProvider`,
`NavDrawer`, `BottomBar`, `NavMenuButton`, `NavPicker` (toggle en Settings). Docs resincronizados:
DESIGN §5/§11/§13/§13b + limpieza de restos "isla" en §1/§3/§4/§6; `decisiones.md` con ADR (INVIERTE
CLAUDE.md §3 / DESIGN.md §5, "no tab bar clásica"); CLAUDE.md §3 con nota. **Verificado: typecheck + build
(client+server) VERDES**, sin tokens `--fab-*` huérfanos. **Pendiente: QA visual del usuario + commit + deploy.**
⚠️ El árbol mezcla ESTO con el trabajo sin commitear de la 6ª sesión (Markdown/historial): al commitear, separar.
**Retoma 2026-07-06:** hecha la **limpieza del `bottomInset` muerto** de la isla — eliminados
`layout/ShellLayoutProvider.tsx`, el `ResizeObserver` que lo escribía en `ChatComposer.tsx` y su wrapper en
`App.tsx`. Typecheck + build (client+server) siguen VERDES. (Revisado además que la reserva `--nav-inset` en
Terminal/Editor va sobre `.keybar`/`.symbar`, no sobre el host de xterm/CodeMirror.)
**Fix móvil (reportado por el usuario):** el teclado dejaba **hueco abajo** y la barra inferior no quedaba
pegada / se reacomodaba. El 1er intento (medir `visualViewport` → var `--app-height`) empeoró (hueco
permanente) y se **revirtió**. Solución final: `.shell` pasa de `100dvh` en flujo a **`position: fixed; inset: 0`**
(anclado al viewport: el teclado se superpone sin reacomodar; barra inferior pegada abajo). DESIGN §13. Build
VERDE (el error `tsc` en `chatStore.ts:144` es de la sesión paralela, no de esto).

**5ª sesión — persistencia migrada de MongoDB a SQLite** (`better-sqlite3`, embebido): ya no hay
contenedor de BD. Detalle abajo en "Deploy" y en `log.md`/`decisiones.md`.

**6ª sesión 2026-07-03 — Chat: Markdown + historial + persistencia del hilo (DESPLEGADO y verificado).**
1) El chat **renderiza Markdown** (antes texto plano): `react-markdown` + `remark-gfm`, `Markdown.tsx`
   por tokens (DESIGN §6.1).
2) **Persistencia del hilo + reanudar al recargar**: SQLite guarda el `thread` (JSON) + `claude_session_id`;
   el cliente genera UUID y materializa con `PATCH` upsert; rehidrata lazy al montar y reanuda con `resume`.
3) **Panel de historial** (`ChatHistory.tsx`, botón 🕘) con abrir/renombrar/borrar; modelo **cerrar ≠ borrar**
   (la × cierra `open:false`, borrar es DELETE explícito). DESIGN §6.2 + decisiones.md al día.
Verificado: typecheck+build (client+server) verdes; revisor pasado (2 fixes aplicados: no truncar el hilo si
no está hidratado, sanear flag `streaming`); **deploy OK** (backend healthy, bundle `index-CWVBUOyH.js`);
**migración SQLite** confirmada contra la BD del volumen; **smoke e2e REST TODO OK** (login→upsert→listar→
rehidratar→cerrar→borrar). Flecos menores en bugs.md (focus-trap del panel). **Sin commit aún** (a la espera).

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

1. **QA visual** de la nueva navegación en el móvil: probar drawer `☰` (abrir/cerrar/scrim/Esc, ítem
   activo) y **barra inferior** (cambiar modo en Settings → Appearance), en las 5 vistas y los 3 temas.
2. **Commit + deploy** cuando el QA esté OK (separar del trabajo de la 6ª sesión al commitear).
   ⚠️ **El deploy va EN EL HOST**, no desde PortaIDE: la app corre dentro de su contenedor y no tiene
   `docker`/socket (ver decisiones.md "RESTRICCIÓN A REVISAR"). Comando en el host:
   `cd /home/kuoyii/servers/portaide && docker compose up -d --build`.
3. **Pendiente pedido por el usuario (bugs.md):** que el **historial del chat** liste también las
   **conversaciones reales de Claude Code** del proyecto (transcripts `.jsonl` del engine, las de VS Code),
   con opción de reanudar por `sessionId`. Diagnóstico hecho; falta decidir alcance e implementar.

Otras mejoras candidatas: git-status en el explorer, split-terminal, endurecer symlinks, 2FA/passkeys.
