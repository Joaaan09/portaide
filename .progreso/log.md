# Log — historial de todo

> Entradas cronológicas (más reciente arriba). Anota qué se hizo en cada sesión.

---

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
