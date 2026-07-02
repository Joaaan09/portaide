# Estado — checkpoint de la última sesión

> Léeme al empezar. Actualízame al terminar cada sesión.

**Última actualización:** 2026-07-02

## Dónde estamos

**Arranque del proyecto.** Se ha montado el **harness de trabajo** (calcado del proyecto SmartPeak y
adaptado a PortaIDE) y toda la documentación de partida. **Todavía no hay código de la app.**

Hecho en esta sesión:

- **`CLAUDE.md`** — instrucciones del proyecto adaptadas a PortaIDE (qué es, arquitectura v1, las 5
  vistas, el chat = Claude Code, reglas de diseño, harness multiagente, convenciones, seguridad).
- **`DESIGN.md`** — sistema de diseño completo extraído del mockup canónico: los **3 temas** con todos
  sus tokens, syntax highlighting, las 5 vistas, la isla de navegación y el motion.
- **`.claude/agents/`** — `explorador`, `ejecutor`, `revisor` (+ README) adaptados.
- **`.claude/skills/`** — copiadas las 3 skills de diseño de SmartPeak (`emil-design-eng`,
  `review-animations`, `design-taste-frontend`) + `skills-lock.json`.
- **`.progreso/`** — este harness de seguimiento (estado / plan / decisiones / log).
- **`scripts/init.sh`**, **`package.json`** semilla (monorepo, sin código aún), **`.gitignore`**.
- El repo se inicializó con git; **sin commit todavía** (pendiente de tu OK).

## Contexto de partida (lo que ya existía)

- **`brand/`** — icono, favicons (16–1024), wordmark, `manifest.webmanifest`, `head-snippet.html`.
  Paleta base violeta (`#0a0810` bg, `#9d5cff`/`#a970ff` acento), IBM Plex Sans + JetBrains Mono.
- **`PortaIDE Brand (offline).html`** y **`Editor Movil (offline).html`** — mockups (norte visual).
  Son páginas "bundled" que se auto-desempaquetan con JS; el HTML real de ambos está desempaquetado
  para consulta en el scratchpad de la sesión, pero la **fuente de verdad** son estos dos archivos.

## Decisiones tomadas (ver decisiones.md)

- **Arquitectura v1**: servidor en el propio VPS (FS local + pty + CLI `claude`), móvil por HTTPS/WS.
- **Puente con Claude Code**: CLI `claude` (streaming), con cambio de modelo/slash-commands en la UI.
  Alias en el VPS: `clauded` = `claude --dangerously-skip-permissions`.

## Siguiente paso (propuesto)

Confirmar el **stack concreto** (libs) y arrancar la **Fase 1**: scaffolding `client/` (Vite + React +
TS + Tailwind, PWA) + tokens de los 3 temas + shell móvil (isla dinámica) + **vista Chat**. El backend
(FS API + pty WS + puente `claude`) en paralelo cuando la vista Chat pida datos reales.
