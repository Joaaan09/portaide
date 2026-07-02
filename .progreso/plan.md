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
- [ ] Vista Settings (VPS connection, Claude Code, appearance)

## Fase 3 — Backend / integración real

- [ ] API de filesystem (árbol / leer / escribir) sobre el proyecto abierto
- [ ] Terminal real: `node-pty` sobre WebSocket
- [ ] **Puente con `claude`**: lanzar el CLI en streaming, parsear eventos → UI del chat (modelo,
      slash-commands, permission mode)
- [ ] **Seguridad (bloqueante para exponer)**: auth de un solo usuario + HTTPS/TLS en todo endpoint
- [ ] PWA: manifest + service worker + `head-snippet` (instalable, offline shell)
