# Plan — tareas y fases

> Lista viva. Marca `[x]` lo hecho. El detalle del orden está en [CLAUDE.md](../CLAUDE.md) §6.

## Fase 0 — Arranque / harness

- [x] Copiar y adaptar el harness de SmartPeak (agentes, skills, .progreso, scripts)
- [x] `CLAUDE.md` adaptado a PortaIDE
- [x] `DESIGN.md` extraído del mockup canónico (3 temas, tokens, 5 vistas, motion)
- [x] `git init` (sin commit todavía)
- [ ] Confirmar el **stack concreto** (CodeMirror 6 vs Monaco, xterm.js, ws, node-pty, store de sesión/ajustes)
- [ ] Scaffolding del monorepo `client/` + `server/` + raíz con `concurrently`
- [ ] Commit inicial + crear rama `staging`

## Fase 1 — Bloquear el sistema de diseño (antes de features)

- [ ] Tokens CSS de los 3 temas (Midnight/Lavender/Magenta) + fuentes (IBM Plex Sans + JetBrains Mono)
- [ ] Shell móvil: marco app-shell + **isla dinámica** de navegación (5 destinos)
- [ ] **Vista Chat** (la estrella): burbujas, thinking, tool-cards (Read/Edit+diff+approve/Bash), input
- [ ] Iterar sobre shell + Chat hasta clavar el tono (validar contra el mockup)

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
