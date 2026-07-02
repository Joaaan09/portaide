# Log — historial de todo

> Entradas cronológicas (más reciente arriba). Anota qué se hizo en cada sesión.

---

2026-07-02 (4ª sesión · fixes sobre Settings desplegado) — Encargo de ampliar Settings (que "no dejaba
cambiar nada"). Trabajé en paralelo con **otra sesión sobre el mismo working tree** que ya había
implementado+commiteado+desplegado la misma vista (Account + Appearance + System `/api/system`);
convergimos casi idénticos (mismo mockup + DESIGN.md → mismo naming/estructura), de ahí el "corte" (los
ejecutores se pisaban en disco). Tras revisión, destilé lo que la versión desplegada NO tenía: **(1)** el
swatch de tema ahora previsualiza el **FONDO** de cada tema (tokens `--bg-{theme}`), no solo el acento
—cumplía a medias DESIGN §10 (regla dura)—; **(2)** stepper de fuente con `aria-disabled` en vez de
`disabled` (no perder el foco de teclado en 11/20); **(3)** `readStoredFontSize` descarta la cadena vacía
(default 14, no 11). Docs: **DESIGN §10 reescrito** a la realidad v1 (System en vez de VPS/SSH; Claude
Code diferido al composer del Chat) + entrada en decisiones.md. Typecheck verde; deploy pendiente del
usuario. **Lección:** dos sesiones en el mismo checkout se pisan — coordinar antes de paralelizar.

2026-07-02 (3ª sesión · lote UX móvil) — Sobre el desplegado, feedback del usuario → 3 subagentes en
paralelo + Settings: **cerrar pestañas** (chat ✕ con DELETE best-effort; editor ya iba), **isla de
navegación arrastrable** (Pointer Events, tap-vs-drag, posición persistida, clamp con safe-area),
**pull-to-refresh** (portado de total-grind, adaptado al scroll por-vista, solo standalone), y
**"Ultracode"** como tope del slider de esfuerzo (activa workflows multiagente vía
`options.settings.enableWorkflows` + effort max). Además se **commiteó y desplegó la vista Settings**
completa que estaba sin commitear (Account + Appearance [tema + tamaño de fuente] + System con
`/api/system` real tras el gate) y se arregló el timeout de `claude --version` (2s→10s: el CLI tarda
~4.3s en arrancar en el contenedor). Verificado: pila healthy, `/api/system` OK (claude 2.1.197, mongo
conectado), gate 401 sin sesión. Pendiente del usuario: QA del gesto de arrastre y del pull-to-refresh
en el iPhone. DESIGN.md §13/13b/13c documentados.

2026-07-02 (3ª sesión · iteración post-deploy) — Feedback del usuario en móvil: **arreglado el auto-zoom
de iOS** al escribir (viewport `maximum-scale=1, user-scalable=no`); **mejorados los controles del composer
del Chat**: selector de modelo con versión + **Fable 5** (verificado que el CLI acepta `--model claude-fable-5`),
modo **Plan** (paridad con Claude Code: Ask/Plan/Auto-edits/Bypass), y **slider de esfuerzo**
(Auto/Low/Medium/High/xHigh/Max → `options.effort` del SDK, por-mensaje). Panel colapsable en el pie para
no cargar el móvil; persistencia en localStorage. Redeploy de frontend+backend, verde.

2026-07-02 (3ª sesión) — **Fase 3 implementada y DESPLEGADA (app funcional, no mock).** Decisiones del
usuario: auth por contraseña+cookie, chat con Approve/Reject reales, workspace estilo VS Code (acceso al
server con selector de carpeta). Validado empíricamente que el CLI headless y el **Agent SDK** autentican
con la suscripción de `~/.claude` (sin API key) → chat vía `@anthropic-ai/claude-agent-sdk` + `canUseTool`.
Implementado con 5 subagentes ejecutores (auth → [terminal ∥ fs/files] → [editor ∥ chat]) y la capa
Docker por el orquestador: **Auth** (JWT httpOnly, gate de `/api` y de los 3 WS), **Terminal** real
(node-pty `/ws/terminal` + xterm), **FS/Files/Editor** (`/api/fs` anti-traversal, Workspace, CodeMirror 6),
**Chat** real (SDK, streaming, aprobaciones reales, mock eliminado). Imagen backend `node:20-slim` con
`claude`/`clauded`/git/bash/node-pty, HOME=/home/kuoyii, uid 1000, mounts de `servers` y `~/.claude`.
Usuario `jcollvir@gmail.com` creado por `.env`. Reseteado el volumen vacío de Mongo (se había creado sin
auth) → backend conecta. Verificado: gate 401 en todo `/api`, WS rechazado sin cookie, Write aprobado/denegado,
y **login OK por la cadena nginx→backend**. Pendiente del usuario: activar WebSockets en NPM y cambiar la
contraseña. Commits `ffbe7a4`,`2bd9f19`,`20c70f1`,`c777714`,`32399b0`,`76306ff`.

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
