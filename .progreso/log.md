# Log — historial de todo

> Entradas cronológicas (más reciente arriba). Anota qué se hizo en cada sesión.

---

2026-07-02 (2ª sesión) — **Fase 0 cerrada + Fase 1 implementada.** Explorado el patrón Docker del VPS
(workflow de 5 agentes sobre smartpeak/total-grind±staging/connectu/fichame): NPM + `reverse_proxy_network`,
patrón SmartPeak elegido. Decisiones: **MERN confirmado** (Mongo en v1, orden del usuario), Docker+NPM,
libs (CodeMirror 6, xterm.js, ws, node-pty, mongoose, CSS Modules sin Tailwind), revisor omitido con
Fable 5. Commit inicial en `main` + rama **`staging`** creada. Scaffolding completo (client Vite+React19+TS,
server Express+TS :4100 con /api/health y WS eco, Docker compose `portaide-*` con mongo:7 en :27018
loopback). Fase 1: tokens 3 temas + `--on-accent`, ThemeProvider, AppShell (glow, fadein), **NavIsland**
del mockup, 4 stubs + **vista Chat completa con mock** (tabs, thinking, tool-cards con diff y
Approve/Reject, typing, composer). Verificado por el orquestador: builds/typecheck verdes, tokens
limpios, compose válido. Pendiente: QA visual del usuario e iterar el tono (última casilla Fase 1).
Commits: `03051bf` (main), `354c2ee`/`945b630`/`7605bbf` (staging).

2026-07-02 — **Arranque del proyecto PortaIDE.** Montado el harness de trabajo clonando el de SmartPeak
(`../smartpeak`) y adaptándolo: agentes `explorador`/`ejecutor`/`revisor` (+README), 3 skills de diseño
copiadas (`emil-design-eng`, `review-animations`, `design-taste-frontend`) + `skills-lock.json`,
`scripts/init.sh`, y la carpeta `.progreso/` (estado/plan/decisiones/log). Escrito `CLAUDE.md` adaptado
(qué es, arquitectura v1, 5 vistas, chat=Claude Code, diseño, harness, convenciones, seguridad) y
`DESIGN.md` completo extraído del mockup canónico `Editor Movil (offline).html` (3 temas con todos sus
tokens, syntax highlighting, las 5 vistas, isla dinámica de navegación, motion). `package.json` semilla
(monorepo, aún sin código) y `.gitignore`. `git init` sin commit. **Decisiones fijadas** (ver
decisiones.md): arquitectura = servidor en el propio VPS; puente = CLI `claude` en streaming con
cambio de modelo/slash-commands en la UI (`clauded` = `claude --dangerously-skip-permissions`); sin DB
en v1. **Aún no hay código de la app**; siguiente paso: confirmar libs y arrancar Fase 1 (scaffolding +
tokens + shell + vista Chat).
