# Plan — tareas y fases

> Lista viva. Marca `[x]` lo hecho. El detalle del orden está en [CLAUDE.md](../CLAUDE.md) §6.

## Fase 0 — Arranque / harness

- [x] Copiar y adaptar el harness de SmartPeak (agentes, skills, .progreso, scripts)
- [x] `CLAUDE.md` adaptado a PortaIDE
- [x] `DESIGN.md` extraído del mockup canónico (3 temas, tokens, 5 vistas, motion)
- [x] `git init` (sin commit todavía)
- [x] Confirmar el **stack concreto** (2026-07-02: MERN confirmado por el usuario — Mongo entra en v1;
      CodeMirror 6, xterm.js, ws, node-pty, mongoose, CSS Modules sin Tailwind; ver decisiones.md)
- [x] Scaffolding del monorepo `client/` + `server/` + raíz con `concurrently` (+ capa Docker completa:
      compose patrón SmartPeak, Dockerfiles multi-stage, nginx con proxy /api y /ws)
- [x] Commit inicial + crear rama `staging`

## Fase 1 — Bloquear el sistema de diseño (antes de features)

- [x] Tokens CSS de los 3 temas (Midnight/Lavender/Magenta) + fuentes (IBM Plex Sans + JetBrains Mono)
      (+ token `--on-accent` añadido a DESIGN.md §3)
- [x] Shell móvil: marco app-shell + **isla dinámica** de navegación (5 destinos)
- [x] **Vista Chat** (la estrella): burbujas, thinking, tool-cards (Read/Edit+diff+approve/Bash), input
      (con datos mock calcados del mockup; el puente real llega en Fase 3)
- [ ] Iterar sobre shell + Chat hasta clavar el tono (validar contra el mockup) — **pendiente de QA
      visual en dispositivo por el usuario** (`npm run dev`; sin navegador disponible en el VPS)

## Fase 2 — Resto de vistas (contra el sistema bloqueado)

- [ ] Vista Files (explorer + git status + estado de conexión)
- [ ] Vista Editor (pestañas, breadcrumb, syntax highlighting, diffs, split terminal, barra de símbolos)
- [ ] Vista Terminal (pestañas, salida coloreada, teclas especiales)
- [x] Vista Settings v1 — **Appearance** (tema con swatches + tamaño de fuente cableado a CodeMirror) +
      **System** (datos reales vía `/api/system`) + Account. *VPS Connection* descartado (v1 sin SSH) y
      *Claude Code* diferido al composer del Chat (ver decisiones.md · 2026-07-02). Desplegado; swatch
      §10 y a11y del stepper afinados en la 4ª sesión.

## Fase 3 — Backend / integración real  ✅ DESPLEGADA (2026-07-02)

- [x] API de filesystem (árbol / leer / escribir) sobre el proyecto abierto (`/api/fs`, anti-traversal)
- [x] Vista Files (árbol lazy + selector de carpeta "Open Folder") y **Editor real (CodeMirror 6)**
- [x] Terminal real: `node-pty` sobre WebSocket (`/ws/terminal`, xterm, `claude`/`clauded` en la imagen)
- [x] **Puente con `claude`**: vía **Agent SDK** (no CLI-streaming) — `canUseTool` con Approve/Reject
      reales, modelo y permission mode en caliente por `/ws/chat`. Mock eliminado.
- [x] **Seguridad (bloqueante para exponer)**: auth de un solo usuario (email+pass → JWT httpOnly),
      gate en todo `/api` y en el upgrade de los WS. TLS lo termina NPM.
- [~] PWA: manifest + `head-snippet` ✅; **service worker offline** pendiente (aplazado).

## Despliegue (Docker + NPM) — hecho

- [x] Imagen backend `node:20-slim` con node-pty compilado, `claude` global + `clauded`, git/bash, mounts.
- [x] `docker compose up -d --build` desplegado y verificado (SPA + health + login por nginx→backend).
- [x] Volumen de Mongo reseteado para que inicialice con auth (el `up` de scaffolding lo creó sin auth).

## Fase 4 — Chat en segundo plano (multi-sesión + cola + push)

> Arquitectura pinneada en `decisiones.md` (2026-07-03 · "Chat en segundo plano: `SessionRuntime`").
> Decisiones del usuario: concurrencia knob (default 3, 0=ilimitado) · default `bypassPermissions` · todo de una.
> **Reafirmada por el usuario (2026-07-06)** como los 4 síntomas a resolver (1 sola conversación a la vez ·
> no poder escribir mientras trabaja · el turno muere al apagar pantalla/salir · faltan notificaciones):
> sigue siendo la **siguiente feature grande**, aún sin empezar.

> **COMPLETADA 2026-07-26** (8ª sesión) — A, B y C implementados, revisados (1ª entrega RECHAZADA, ver
> `log.md`) y **desplegados**. Falta el QA en el iPhone. La Fase 4 se amplió con la **terminal persistente**
> (el pty tampoco sobrevivía al socket) y el **heartbeat**, que no estaban en el plan original.

- [x] **A. Backbone server**: `SessionRuntime` (turno desacoplado del WS, cola, concurrencia `CHAT_MAX_CONCURRENT_TURNS`),
      `bridge.ts` emitiendo a un sink en vez de al `ws`, WS multiplexado (`attach/detach/message/stop`, snapshot-on-attach,
      broadcast) en `ws.ts`+`index.ts`. Default permission mode → bypass. Persistencia server-side del hilo vivo.
- [ ] **B. Cliente**: `chatStore.ts` al protocolo nuevo (estado de turno por sesión, sin `pendingLocalId` global,
      re-attach + snapshot al reconectar, enviar-mientras-trabaja = encolar, N sesiones en streaming a la vez).
- [ ] **C. Push**: `web-push` + VAPID + tabla `push_subscriptions`; `sw.js` (push + notificationclick); registro SW +
      toggle "Notificaciones" en Settings. Disparo al terminar/error sin subscriber activo. (Caveat iOS PWA.)
- [x] **Verificación**: typecheck + build (client+server) verdes; smoke del ciclo (attach→message→cerrar socket→
      el turno sigue→reattach recupera→push). Actualizar `estado.md`/`log.md`.

## Fase 5 — Source Control (git desde la UI)  ✅ IMPLEMENTADA (2026-08-04, sin desplegar)

> DESIGN §8.1 + ADR 2026-08-04 en `decisiones.md`. Alcance esencial y sin operaciones destructivas.

- [x] Backend `server/src/git/` (service sobre el binario `git` + 8 endpoints bajo auth)
- [x] Credencial por `GITHUB_TOKEN` (env → credential helper efímero; nunca en argv ni al cliente)
- [x] Panel `SourceControl` (hoja inferior) + chip de rama en Files
- [x] **git-status en el explorer** (marcas M/A/D/?/R por archivo) — pendiente que venía de la Fase 3
- [x] Verificación: typecheck + build + 39 pruebas reales del módulo + 19 smoke HTTP
- [ ] **QA en el móvil** (incluido el primer push real, que NO se ha ejecutado desde aquí)
- [ ] v2 opcional: ver el diff de cada archivo antes de guardar; pull requests / issues de GitHub

## Rendimiento del Chat — techo de render (2026-08-05/06)

> La PWA se reiniciaba al volver a la vista Chat: el hilo se pintaba entero (~46.000 nodos) y el WebView
> de iOS moría. DESIGN §6.7 + ADR 2026-08-05.

- [x] **Ventana del hilo**: presupuesto duro de 120 bloques recortando el primer item por su cola,
      `▲ Mostrar mensajes anteriores` (+120) sin mover la posición de lectura, ventana congelada mientras
      se lee hacia arriba, reset en fase de render al cambiar de conversación
- [x] **Techo por card**: diff 24 líneas, bash 16, `⋯ N líneas más` (expansión efímera)
- [x] **`AssistantMessage` memoizado** + hilo y composer fuera del pull-to-refresh (`data-ptr="off"`)
- [x] Verificación: typecheck + build + medición con la `threadWindow` real → **46.047 → 2.538 nodos**
- [ ] **Rebuild del frontend** (el bundle servido tiene una versión intermedia: la 16ª sesión lo
      redesplegó a mitad de este trabajo) + **QA en el iPhone** (ver `estado.md`)
- [ ] Opcional: quitar el remonte de vistas (`AppShell key={view}`) para no perder el borrador del
      composer ni el scroll — ver `bugs.md`

## FS — ver imágenes + descargas (2026-10-23)

> Pedido del usuario: ver imágenes en la app, descargarlas, y descargar carpetas enteras. ADR + DESIGN §7.1/§8.

- [x] Backend: `GET /api/fs/raw` (archivo crudo inline, MIME, tope 25 MB) y `GET /api/fs/download`
      (archivo attachment o **carpeta → zip** con `archiver`, streaming), bajo auth + `resolveSafe`
- [x] Cliente: `isImagePath/fsRawUrl/fsDownloadUrl`; Editor con `<ImagePreview>` + estado `binary`;
      FileTree con acción `⤓` por fila (archivo/carpeta)
- [x] Verificación: typecheck + build + harness de runtime 19/19 (MIME/bytes, zip anidado, traversal)
- [ ] **QA en el iPhone** (PWA): abrir imagen, descargarla, descargar carpeta grande (zip) + commit/deploy

## Pendientes abiertos (2026-07-26)

- [ ] **QA del push en el iPhone** — la cadena servidor→Apple está verificada (suscripción registrada y
      envío manual con `201`), pero **falta confirmar la entrega en el dispositivo** y que los disparos
      automáticos ("sigue trabajando" al irse con turno vivo / "terminó") lleguen cuando toca. Nota de
      tiempos: tras bloquear la pantalla, el socket tarda hasta ~60 s en darse por muerto (heartbeat de
      30 s × 2) y luego hay 20 s de debounce → el aviso de "sigue trabajando" puede tardar **~80 s**.
      Si hace falta, bajar `PUSH_WORKING_DELAY_MS` y/o el intervalo del heartbeat.
- [x] **~~REVISAR LO DEL SSH~~ → RESUELTO 2026-07-31: backend en el host (systemd).** SSH descartado
      (PortaIDE vive en el mismo VPS). Código del repo migrado (compose/nginx/env/systemd/deploy). Ver
      ADR "Backend en el HOST (systemd)" en `decisiones.md`.
- [ ] **EJECUTAR la migración a host** (acción del host, no del contenedor) — seguir `deploy/README.md`:
      **paso 0 Tailscale** (endurecer borde) → UFW cerrar 4100 → `npm ci && build` en host → systemd
      `enable --now` → rebuild frontend → bajar `portaide-backend` Docker viejo → verificar. El fix del
      selector de carpeta se despliega junto con esto.
- [ ] **QA del resto de la 8ª sesión en el móvil**: terminal que sobrevive a cambiar de vista / bloquear /
      cerrar la app, varias pestañas a la vez, aviso de shell muerta, mensajes sin red (burbuja "No
      entregado" + reintentar), tira de conexión solo cuando hay problema.
