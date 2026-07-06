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

- [ ] **A. Backbone server**: `SessionRuntime` (turno desacoplado del WS, cola, concurrencia `CHAT_MAX_CONCURRENT_TURNS`),
      `bridge.ts` emitiendo a un sink en vez de al `ws`, WS multiplexado (`attach/detach/message/stop`, snapshot-on-attach,
      broadcast) en `ws.ts`+`index.ts`. Default permission mode → bypass. Persistencia server-side del hilo vivo.
- [ ] **B. Cliente**: `chatStore.ts` al protocolo nuevo (estado de turno por sesión, sin `pendingLocalId` global,
      re-attach + snapshot al reconectar, enviar-mientras-trabaja = encolar, N sesiones en streaming a la vez).
- [ ] **C. Push**: `web-push` + VAPID + tabla `push_subscriptions`; `sw.js` (push + notificationclick); registro SW +
      toggle "Notificaciones" en Settings. Disparo al terminar/error sin subscriber activo. (Caveat iOS PWA.)
- [ ] **Verificación**: typecheck + build (client+server) verdes; smoke del ciclo (attach→message→cerrar socket→
      el turno sigue→reattach recupera→push). Actualizar `estado.md`/`log.md`.
