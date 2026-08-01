# Estado — checkpoint de la última sesión

> Léeme al empezar. Actualízame al terminar cada sesión.

**Última actualización:** 2026-08-01 (10ª sesión)

## 10ª sesión (2026-08-01) — historial del engine (conversaciones del VPS) cableado en la UI

**Petición:** "quiero ver el historial de conversaciones que hay en el VPS" (ya con Tailscale + host).
**No era Tailscale.** El backend para leer los transcripts reales del engine (`~/.claude/projects/*.jsonl`,
incl. VS Code) **ya existía y estaba verificado** (ADR 2026-07-06) pero la **UI nunca se cableó**; el panel
solo listaba las sesiones SQLite nacidas en PortaIDE. Cableado en **Modo Directo** (autorizado por el
usuario), **sin tocar el backend**:

- **`chatStore.ts`**: `fetchEngineHistory(cwd)` (lista del engine, por proyecto) + `openEngineSession`
  (descarga el transcript → lo **materializa en SQLite** vía upsert con `thread`+`claudeSessionId` reusando
  el sessionId del engine como id → `attach` repinta y `resume` continúa). `fetchHistory` ahora expone
  `claudeSessionId` para dedup.
- **`useChatSession.ts`** (fachada), **`ChatView.tsx`** (pasa el `workspace` como cwd + `onOpenEngine`).
- **`ChatHistory.tsx` + `.module.css`**: panel en **2 secciones** — *PortaIDE* (SQLite) y *En el servidor ·
  Claude Code* (engine del proyecto), con **dedup** por `id ∪ claudeSessionId`.

**Verificado:** typecheck + build (server tsc + client vite) **verdes**. Detalle y alternativas en
`decisiones.md` (ADR 2026-08-01). **Sin commit ni deploy.** Falta **QA en dispositivo** tras desplegar:
abrir el panel → sección "En el servidor" con las conversaciones del proyecto → tocar una → repinta el hilo
y se puede continuar (resume). Recordatorio: el engine es **por proyecto**, así que depende del workspace
abierto (raíz por defecto `/home/kuoyii/servers`).

## 9ª sesión (2026-07-31) — fix del selector de carpeta + migración backend→host (repo)

Dos cosas, ambas **sin commit ni deploy**:

1. **Fix UI:** el botón "Open this folder" del `FolderPicker` quedaba tapado por la barra inferior en
   móvil (overlay atrapado en el contexto de apilamiento de `.viewport`). Solución: `createPortal` a
   `document.body` + `z-index:200`. Archivos: `client/src/views/Files/FolderPicker.tsx`,
   `FilesView.module.css`.

2. **Decisión de arquitectura + migración (ADR 2026-07-31 en decisiones.md):** se movió el **backend al
   HOST (systemd)**; el frontend sigue en Docker. Objetivo: Terminal = shell real del VPS (clauded,
   docker, logs) y deploy desde la propia app. **El lado-repo está hecho y con typecheck verde**;
   falta ejecutar los pasos del host (ver `deploy/README.md`). SSH quedó descartado (PortaIDE vive en el
   mismo VPS). Cambios: `docker-compose.yml`, `client/nginx.conf`, `server/src/config/env.ts` + `index.ts`
   (nuevo `HOST`), `deploy/portaide-backend.service`, `scripts/deploy.sh`, `deploy/README.md`, `.env.example`.

### PENDIENTE de esta sesión — acción del host (no ejecutable desde el contenedor)

Seguir **`deploy/README.md`** en el host, en orden: **paso 0 Tailscale** (endurecer el borde, innegociable)
→ paso 1 UFW (cerrar 4100) → `npm ci && build` en el host → systemd `enable --now` → rebuild frontend →
bajar el `portaide-backend` de Docker viejo → verificar (whoami=kuoyii, docker ps, tarjetas del chat).
El fix del selector de carpeta se despliega **junto** con esto (o antes, con el compose actual si no migras aún).

## Dónde estamos

**Fase 3 desplegada y funcional** (login, terminal real, filesystem, editor y chat con Claude real).
Sobre eso, la 8ª sesión ha cerrado el **trabajo en segundo plano de verdad**: se puede lanzar trabajo,
bloquear el móvil o salir de la app, y seguir. Rama: `staging`. **Todo el trabajo de esta sesión está
SIN COMMIT y SIN DESPLEGAR.**

## 8ª sesión (2026-07-26) — trabajo en 2º plano, terminal persistente y push

**Diagnóstico medido contra el VPS real** (no supuesto): cortando el WS a la fuerza, el **Chat ya
sobrevivía** (60 s de trabajo completados sin cliente; el `snapshot` lo recuperaba todo) pero la
**Terminal moría**. El "parece parado" del Chat era del cliente: socket **zombi en `OPEN`** y ningún
listener de ciclo de vida. Detalle en `decisiones.md` (4 ADRs nuevos).

**Implementado (typecheck + build VERDES en server y client):**

1. **`server/src/terminal/runtime.ts`** — el pty ya no muere con el socket: `TerminalRuntime` con ring
   buffer de 256 KiB, protocolo multiplexado (`attach|input|resize|detach|kill` → `snapshot|data|exit|
   error`), **sesiones muertas retenidas** (para enterarte de que tu `clauded` murió, con su `exitCode`),
   reaper de huérfanos a 2 h y cota `TERMINAL_MAX_SESSIONS=6`. Arreglado: el `cwd` del cliente se ignoraba.
2. **`server/src/ws/heartbeat.ts`** — ping/pong (30 s) que hace `terminate()` de los sockets fantasma.
   Sin esto el server creía que seguías mirando y el push nunca se dispararía.
3. **Cliente Terminal** — `terminalStore` singleton, pestañas en localStorage, `detach` (NUNCA `kill`) al
   cambiar de vista, reconexión con backoff+jitter y aviso de sesión terminada con "Reiniciar shell".
4. **Cliente Chat** — detección de zombi por `lastFrameAt`, listeners `visibilitychange`/`pageshow`/
   `focus`/`online`, **`ack` del servidor** con reenvío de no confirmados (+ guard de **idempotencia por
   `localId`** en `runtime.ts`: un reenvío no puede ejecutar el turno dos veces), ids deterministas,
   scroll que respeta dónde leías, y fuera la "sesión fantasma" cuando falla la carga inicial.
5. **Web Push (VAPID)** — `server/src/push/*` + `client/public/sw.js` + panel en Settings. Avisos:
   **"sigue trabajando"** (al irte con turno vivo, debounce 20 s) y **"terminó/falló"**, mismo `tag` por
   sesión (el segundo reemplaza al primero).
6. **Refactor** — `client/src/components/ConnBanner/` compartido por Chat y Terminal (DESIGN §6.3).

**Ciclo de revisión (importante):** la primera entrega fue **RECHAZADA** por el `revisor` con 2 críticos
reproducidos (el borrado por id que mataba al runtime sucesor dejando `bash -l` huérfanos; el guard de
idempotencia que no cubría la espera de slot) + 4 altos/medios. Corregidos todos y re-verificados con repros
antes/después. La 2ª pasada destapó 2 altos más, **preexistentes**, también corregidos y verificados: la
exclusión mutua por sesión (`if (this.turn)` no cubría la espera de slot → dos agentes en paralelo sobre el
mismo repo) y el flag `stopped` pegajoso (se tragaba en silencio el siguiente mensaje del usuario). Veredicto
final: **desplegable**. Lo que se dejó sin arreglar está en `bugs.md`, todo menor.

## PENDIENTE — acción del usuario

1. **Commit + deploy** (el deploy va EN EL HOST, no desde PortaIDE):
   `cd /home/kuoyii/servers/portaide && docker compose up -d --build`.
   ⚠️ El protocolo de `/ws/terminal` **cambió sin retrocompatibilidad**: hasta desplegar, cliente y
   servidor viejos siguen siendo coherentes entre sí, pero no mezcles versiones.
2. **QA en el iPhone tras desplegar** (nada de esto se ha probado en dispositivo real):
   - **Instalar la PWA en la pantalla de inicio** — en iOS el push NO llega desde Safari normal.
   - Settings → Notificaciones → activar → **"Enviar notificación de prueba"**.
   - Terminal: lanzar algo largo, cambiar de vista / bloquear el móvil / volver → debe seguir y repintar.
   - Chat: enviar, bloquear el móvil, volver → debe seguir y llegar el push al terminar.
3. **Activar "Websockets Support"** en el proxy host de NPM (pendiente de sesiones anteriores; sin esto
   terminal y chat no conectan).
4. **Cambiar `AUTH_PASSWORD`** en `.env` (la actual es débil y viajó en claro por el chat) y redesplegar.

## Cómo entrar

- **URL**: la configurada en Nginx Proxy Manager → `portaide-frontend`. Credenciales y secretos en
  `/home/kuoyii/servers/portaide/.env` (gitignored, chmod 600): `SESSION_SECRET`, `AUTH_EMAIL`,
  `AUTH_PASSWORD` y las 3 `VAPID_*` nuevas. Backend en el 4100 (interno).
- Los `MONGO_*` del `.env` ya no se usan (borrables); el volumen `portaide_mongo_data` y el contenedor
  `portaide-mongo` quedaron huérfanos tras la migración a SQLite y pueden eliminarse.

## Flecos conocidos (ver bugs.md) — no bloqueantes

- Nada de la 8ª sesión está probado en runtime con navegador (sí con pruebas reales de pty y de las rutas
  HTTP de push, pero no en un iPhone).
- Deep-link del push: al pulsar la notificación con la app ya abierta navega al Chat y selecciona la
  sesión; en arranque en frío depende de `portaide:chat:activeId`.
- Files no muestra estado git por archivo (falta endpoint git-status).
- Editor: split-terminal aplazado a v2; undo se reinicia al cambiar de pestaña.
- FS: `resolveSafe` no resuelve symlinks (aceptable v1, un solo usuario).
- La terminal descarta las teclas pulsadas mientras no hay socket (decisión: reenviarlas podría ejecutar
  comandos fuera de contexto).

## Siguiente

1. Commit (separando lógicamente si procede) + deploy + QA en el iPhone.
2. **Decidir lo de "ver los logs desde PortaIDE"**: la premisa del SSH era falsa (`~/.claude` y
   `/home/kuoyii/servers` ya están montados del host; lo único que falta es acceso a Docker, cuyo montaje
   está comentado en `docker-compose.yml:49`). Ver el ADR de 2026-07-26 en `decisiones.md`: opción 1
   (backend en el host con systemd) u opción 2 (montar el socket), **no** SSH con contraseña.
3. Candidatas: git-status en el explorer, split-terminal, endurecer symlinks, 2FA/passkeys.
