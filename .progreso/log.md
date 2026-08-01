# Log — historial de todo

> Entradas cronológicas (más reciente arriba). Anota qué se hizo en cada sesión.

---

2026-07-26 (8ª sesión · **trabajo en 2º plano de verdad: terminal persistente + cliente a prueba de móvil +
push**) — El usuario reportó que al bloquear el móvil o salir de la app "se ve que ha parado", y pidió además
varias pestañas de consola con sesiones de Claude simultáneas y notificaciones push. **Con arnés de subagentes
(autorizado explícitamente).**

**Diagnóstico medido, no supuesto.** Se probó contra el backend real del VPS cortando el WebSocket a la fuerza
(`terminate()`): el **Chat NO se paraba** (60 s de trabajo completados sin cliente conectado; el `snapshot` al
reconectar traía todo), pero la **Terminal SÍ moría** (`pty.ts` mataba el proceso en `ws.on('close')`; además
`AppShell` con `key={view}` la mataba con solo cambiar de vista). El "parece parado" del Chat era del cliente:
socket **zombi en `OPEN`** y **cero listeners de ciclo de vida** en toda la app.

**Implementado:** (1) `server/src/terminal/runtime.ts` — el pty pasa a un `TerminalRuntime` propio con ring
buffer de 256 KiB, protocolo multiplexado `attach|input|resize|detach|kill`, retención de sesiones muertas
(para enterarte de que tu `clauded` murió), reaper a 2 h y cota de 6; arreglado el `cwd` que se ignoraba.
(2) `server/src/ws/heartbeat.ts` — ping/pong que hace `terminate()` de los sockets fantasma (prerequisito del
push). (3) Cliente Terminal: `terminalStore` singleton, pestañas en localStorage, `detach` (nunca `kill`) al
cambiar de vista, reconexión con backoff+jitter. (4) Cliente Chat: detección de zombi por `lastFrameAt`,
listeners `visibilitychange`/`pageshow`/`focus`/`online`, **`ack` del server** + reenvío idempotente por
`localId` (con guard de idempotencia también en `runtime.ts`: un reenvío no puede ejecutar el turno dos veces),
ids deterministas y scroll que respeta dónde estabas leyendo; fuera la "sesión fantasma" al fallar la carga.
(5) **Web Push (VAPID)** para iPhone: SW nuevo, avisos "sigue trabajando" (al irte con turno vivo, debounce
20 s) y "terminó/falló" con el mismo `tag`, panel en Settings con detección de standalone. (6) Refactor:
`components/ConnBanner/` compartido por Chat y Terminal (se había duplicado el chasis).

**Revisión: RECHAZADA la primera entrega.** El `revisor` reprodujo **dos fallos críticos** que habían pasado
typecheck, build y la autoverificación de quien los escribió: (1) el borrado diferido del runtime de terminal
borraba **por id**, así que al reiniciar una pestaña mataba del mapa a su sucesor → terminal en solo-lectura
sin aviso y **`bash -l` huérfano que sobrevivía al `shutdown()`**; (2) el guard de idempotencia del chat
—escrito por el orquestador— **no cubría la espera de slot**, de modo que un reenvío sí podía ejecutar el
turno dos veces. Corregidos ambos con repro antes/después, más los altos (el `ack` borraba la burbuja del
usuario de la pantalla; una pestaña muerta revivía sola; el watchdog cortaba el socket al teclear una
contraseña sin eco) y dos medios (rechazos sin `catch` que en Node 20 **matan el proceso**; `selectSession`
fantasma). De propina: cerrar una terminal ahora **escala SIGHUP → SIGKILL**, porque una shell con
`trap '' HUP` sobrevivía al cierre y al apagado del servidor.

**Verificado:** typecheck server+client y `npm run build` VERDES; pruebas reales con pty ejecutadas **contra
el código pre-fix y post-fix** (identidad de runtime, exit rezagado, shell que ignora SIGHUP, sin procesos
huérfanos tras `shutdown()`), repro de idempotencia con el slot ocupado, y rutas de push (401/400/201/409/503);
secretos comprobados (`.env` ignorado, claves VAPID reales fuera del repo, placeholders en `.env.example`).
**Nada probado en navegador ni en el iPhone.** **SIN commit y SIN desplegar** (a la espera del usuario).
DESIGN.md §6.3/§9.1/§10.1 y `decisiones.md` (4 ADRs nuevos, incluido el "no" al SSH con contraseña) al día.

2026-07-21 (meta · harness extraído como plantilla reutilizable) — El usuario pidió el harness de agentes
"como plantilla" para aplicarlo a otros proyectos. Extraído a **`~/harness-template/`** (FUERA del repo de
PortaIDE; este repo no cambia salvo esta entrada): `install.sh` + `template/` (CLAUDE.md genérico con
marcadores «RELLENAR», los 3 agentes, `.progreso/` con los 5 archivos como formularios, `scripts/init.sh`,
esqueleto de DESIGN.md) + `skills/` (las 3 de craft de diseño + `skills-lock.json`). Se cotejó SmartPeak vs
PortaIDE para plantillar la versión **evolucionada**, no la de origen: §8 invertido a **Modo Directo por
defecto** con "botón rojo" para los subagentes (SmartPeak delegaba por defecto), excepción del revisor con
modelos de gama alta, y seguridad como sección de regla dura (§11). Los agentes resultaron ser idénticos
entre proyectos salvo particularizaciones → en la plantilla van con huecos «RELLENAR» para las reglas duras
y los riesgos típicos. `install.sh` sustituye `{{PROJECT}}`, no sobrescribe lo existente (`--force`) y tiene
flags `--design` / `--skills`. **Verificado:** instalación limpia en un destino de prueba (16 archivos, 0
placeholders sin sustituir), `init.sh` correcto, segunda pasada conserva lo existente; prueba borrada.
**Transporte (pedido: usarlo en un proyecto FUERA del VPS):** elegido repo de GitHub. `~/harness-template`
inicializado como repo git (rama `main`, commit inicial, `.gitignore`) con remoto
`https://github.com/Joaaan09/harness-template.git`. **El push queda pendiente del usuario**: el VPS no tiene
`gh`, ni `credential.helper`, ni clave SSH en GitHub (`ssh -T git@github.com` → permission denied), así que
no se puede autenticar desde aquí. También queda un tarball `~/harness-template.tar.gz` (66K) como plan B.

---

2026-07-06 (fix móvil PWA · seguía el hueco abajo en modo barra) — El usuario (en la PWA standalone, modo barra
inferior) seguía viendo hueco abajo tras el fix anterior. El fuente ya estaba correcto (`.shell` fixed inset:0
+ barra fixed `bottom:0`), así que la captura correspondía a un build previo; aun así se **blindó** el marco:
`html, body, #root { height:100%; overflow:hidden }` + `overscroll-behavior:none` en `body` → el documento no
puede scrollear/bouncing (causa típica del hueco por teclado en iOS PWA). Build verde; reglas presentes en el
CSS compilado. **OJO: requiere rebuild+redeploy del frontend en el host y recargar la PWA** (iOS cachea: cerrar
la app del multitarea y reabrir). No desplegable desde PortaIDE (dentro del contenedor). Sin commit.

---

2026-07-06 (fix ALTO · migrar el cliente del chat al SessionRuntime) — El usuario pidió "arregla ese bug": el
server ya usaba el SessionRuntime (protocolo `attach`/`snapshot`/`message` multiplexado) pero `chatStore.ts`
seguía en el protocolo viejo (`user_message` + eventos directos con `pendingLocalId`) → el chat no conectaría.
Reescrito `chatStore.ts` (Modo Directo, sin subagentes) al protocolo nuevo: `attach`/`detach` a cada pestaña
abierta (+ re-attach al reconectar → snapshot-on-attach = "ponerse al día" tras pantalla apagada), `message`/
`stop`/`permission`/`set_model`/`set_permission_mode` con `sessionId`; procesa `snapshot`/`event`/`status`. El
hilo se **ensambla** desde el `LogEvent[]` autoritativo del server con un reducer puro (`reduceEvent` + helpers
de bloques reutilizados del código previo). Eliminados del cliente `user_message`, `loadThread`, `persistSession`,
`hydrated`, `pendingSend` (el server es autoritativo del hilo y lo persiste él). Verificado: typecheck+build
(client) VERDES; **contrato cotejado** campo a campo con `ws.ts`/`runtime.ts` (7 verbos enviados = 7 aceptados;
3 frames emitidos = 3 procesados; 0 `user_message` restantes). **Pendiente e2e** (browser+WS+claude) tras deploy,
bloqueado por WS-support en NPM + working tree con trabajo de otros terminales. **HALLAZGO:** detectado **otro
terminal editando `AppShell.tsx` en vivo** (fix del viewport/teclado con `useViewportHeight`, que apareció y
desapareció del import entre dos comandos) → trabajo concurrente en el cliente, riesgo de pisarse. Docs: bugs.md
(bug ALTO cerrado), estado.md, decisiones.md (ADR SessionRuntime ya existente). Sin commit ni deploy.

---

2026-07-06 (fix móvil · teclado deja hueco / barra no pegada abajo) — El usuario reportó que al abrir y cerrar
el teclado en el móvil quedaba un espaciado abajo, y que la barra inferior de nav debe quedar SIEMPRE pegada
al borde real y NO reacomodarse con el teclado. **1er intento (descartado):** medir `window.visualViewport` y
conducir la altura del shell con una var `--app-height` (`useViewportHeight`) — empeoró: metía un hueco
permanente al encoger el shell. **Solución final:** revertido ese hook; `.shell` pasa de `100dvh` en flujo a
**`position: fixed; inset: 0`**, anclado al viewport → el teclado solo se superpone, al cerrarse todo queda en
su sitio (sin hueco) y la barra inferior (fixed) queda pegada abajo. Verificado seguro con `PullToRefresh` (no
aplica transform a sus hijos; escucha touches por bubbling). DESIGN §13 reescrito. Build (vite, client+server)
VERDE; el `tsc -b` marca `chatStore.ts:144` (var `snippet` sin usar) pero es de la **sesión paralela** (no lo
toqué). Sin commit (a la espera del QA del usuario en el móvil).

---

2026-07-06 (feature backend · historial del chat con los transcripts REALES del engine) — Retomada la tarea
que quedó abierta de la 6ª sesión (el usuario la reanudó desde el propio PortaIDE). El panel de historial solo
listaba las conversaciones de la BD de PortaIDE; el usuario quiere ver las suyas de Claude Code/VS Code del
proyecto. Decisión del usuario: opción **B (repintar + reanudar)**, **solo el proyecto abierto**, en **Modo
Directo sin subagentes**. Implementado **SOLO EL BACKEND**: nuevo `server/src/chat/engineHistory.ts` (lee
`~/.claude/projects/<cwd-sanitizado>/*.jsonl`, convierte el transcript **1:1 a `LogEvent[]`** — el mismo log
que el SessionRuntime produce en vivo, así el cliente lo repinta sin caso especial y se reanuda con `resume`;
anti-traversal) + endpoints REST `GET /api/chat/engine/sessions[?cwd]` (lista con `aiTitle`/fecha/rama) y
`.../:id` (transcript→`LogEvent[]`). typecheck+build (server) VERDES; smoke sobre transcripts reales OK (18
sesiones, 348 eventos válidos, `tool_use`↔`tool_result` casados, traversal bloqueado). **NO desplegado** (el
chat está desincronizado) **NI cliente tocado**. **HALLAZGO (→ bugs.md, ALTO):** el server ya usa el
SessionRuntime (protocolo `attach`/`snapshot`/`message` multiplexado) pero `chatStore.ts` sigue en el
protocolo viejo (`user_message`) → el chat no conectaría así; falta migrar el cliente (bloquea la UI del
historial del engine). Docs: decisiones.md (ADR) + bugs.md (2 entradas) + DESIGN §6.2 (nota).

---

2026-07-06 (retoma 7ª sesión · nav drawer/bottombar — cierre y limpieza) — Se cortó la conversación de la 7ª
sesión con la nueva navegación ya IMPLEMENTADA en el árbol (isla `NavIsland` eliminada → `NavModeProvider` +
`NavDrawer` (☰ + panel lateral deslizante, por defecto) + `BottomBar` (barra inferior alternativa) +
`NavMenuButton` en las 5 cabeceras + `NavPicker` en Settings; DESIGN §5/§13b + CLAUDE §3 + decisiones.md ya
resincronizados). Al retomar: revisado que está todo montado y coherente (☰ en las 5 cabeceras; reserva por
modo con `--nav-inset` sobre `.keybar`/`.symbar`, no sobre el host de xterm/CodeMirror), y **completada la
limpieza pendiente del `bottomInset` muerto**: eliminados `layout/ShellLayoutProvider.tsx`, el `ResizeObserver`
del composer y el wrapper en `App.tsx`. Typecheck + build (client+server) VERDES. Sin commit ni deploy (a la
espera del QA visual del usuario en el móvil).

---

2026-07-06 (progreso · el usuario reafirma la Fase 4 y reabre la revaloración SSH/contenedor) — El usuario
pidió "anotar como pendiente" los 4 síntomas del chat: (1) solo **1 conversación activa** a la vez, (2) no
poder **escribir mientras el agente trabaja**, (3) el turno **muere al apagar la pantalla / salir de la app**,
(4) falta un **sistema de notificaciones** de "chat trabajando/terminado". **Ya estaban capturados** —casi
literalmente— en la **Fase 4 del plan** + el ADR 2026-07-03 "Chat en segundo plano (`SessionRuntime`)", con
sus decisiones ya tomadas (concurrencia knob, bypass default, Web Push + caveat iOS). Queda **reafirmado como
la siguiente feature grande** (aún sin empezar); anotado en plan.md. Además pidió **revalorar usar SSH** dado
que "todo vive dentro del contenedor": remitido al análisis previo (log 2026-07-02 + ADR "RESTRICCIÓN A
REVISAR") y **reabierto** en decisiones.md ("Pendientes de decidir") como argumento de capacidad/DX (no de
seguridad): SSH/host no es más seguro, amplía el blast radius; si se prioriza, endurecer el borde primero.
Solo docs de progreso; sin cambios de código.

---

2026-07-06 (harness · el default del multiagente pasa a Modo Directo) — El usuario pidió añadir a
CLAUDE.md un "Protocolo crítico de activación de subagentes": por defecto el orquestador trabaja en
**Modo Directo** (ejecuta él mismo) y solo despliega subagentes con autorización explícita (pregunta
"botón rojo" ante tareas de alto impacto: módulos/vistas nuevos, refactor masivo o >2 archivos).
Como esto **invertía** el default anterior ("coordinar, no ejecutar" + "Flujo de cada tarea" delegando
por defecto), se reordenó §8 para dejarlo coherente: intro reformulada → protocolo (filtro de entrada)
→ "Flujo cuando el arnés está activado", aclarando que `.progreso/` es obligatorio en ambos modos.
Registrado en decisiones.md (ADR 2026-07-06). Solo docs; sin cambios de código, sin commit.

---

2026-07-03 (7ª sesión · navegación: retirada la isla → drawer ☰ + barra inferior) — Retomada una conversación
que el usuario dejó a medias (se quedó sin límite); reconstruida desde los transcripts `.jsonl` del engine.
El usuario había decidido **quitar la isla flotante** (poco integrada/predecible) y ponerla como **drawer con
hamburguesa `☰` por defecto + barra inferior alternativa**, intercambiables en Settings. Implementado: se
elimina `NavIsland`; nuevos `NavModeProvider` (preferencia `navMode` en localStorage + var `--nav-inset` +
estado del drawer), `NavDrawer` (panel lateral, scrim, focus-trap, Esc, foco inicial/devolución, 5 destinos),
`BottomBar` (barra fija, 5 ítems, `aria-current`), `NavMenuButton` (☰ que se auto-oculta en modo barra),
`NavPicker` (toggle en Settings → Appearance). Clearance migrada de `--fab-clear` a `--nav-inset` (0 en drawer,
56px en bottombar) en las 7 superficies. Docs: DESIGN §5/§11/§13/§13b reescritos + restos "isla" limpiados en
§1/§3/§4/§6; `decisiones.md` con ADR (INVIERTE el "no tab bar clásica" de CLAUDE.md §3 / DESIGN.md §5); CLAUDE.md
§3 con nota. Verificado por el orquestador: **typecheck + build (client+server) verdes**, sin tokens `--fab-*`
huérfanos, `NavIsland` sin referencias. Parte del trabajo lo había dejado un ejecutor previo interrumpido
(provider+tokens+clearance+NavMenuButton.tsx); completado el resto a mano (los `.module.css` y componentes que
faltaban, cableado del ☰ en las 5 cabeceras, App.tsx, borrado de la isla). **Sin commit ni deploy** (a la espera
de QA visual). Pendiente aparte anotado en bugs.md: historial del chat con los transcripts reales de Claude Code
(los de VS Code), que el usuario pidió en la conversación de la 6ª sesión y quedó sin implementar.

---

2026-07-03 (feature · historial + persistencia del hilo de chat) — Los dos síntomas que reportó el usuario
(no hay historial de conversaciones; al recargar el chat abierto se pierde/cierra) tenían la misma raíz:
SQLite solo guardaba la meta de las pestañas, nunca el hilo ni el `claudeSessionId` (callback vacío). Ahora:
**backend** guarda `thread` (JSON) + `open` en `chat_sessions` (migración idempotente ALTER TABLE), con
`GET /sessions/:id`, `PATCH /sessions/:id` **upsert** (INSERT ON CONFLICT), body límite 5MB. **Cliente**:
identidad por UUID (sin reconciliación local↔server), `persistSession`/`loadThread` (rehidratación lazy de
items **y** claudeSessionId), `activeId` en localStorage, modelo **cerrar ≠ borrar** (× → `open:false`;
`deleteSession` real), acciones `reopenSession`/`renameSession`/`fetchHistory`. **UI**: nuevo `ChatHistory.tsx`
(drawer overlay, botón 🕘, renombrar inline, borrar con confirmación, fecha relativa, a11y) por tokens
(DESIGN §6.2). Orquestado con 1 explorador + 3 ejecutores (backend/cliente-lógica/UI) + revisor. El revisor
encontró 2 huecos reales (truncado del hilo si el turno arranca sin rehidratar; `streaming` fantasma tras
recarga) → arreglados por el orquestador (persistSession no manda `thread` si `!hydrated` + solo-meta con turno
vivo; saneo de `streaming` en persist y en loadThread). Fix craft: papelera SVG en vez de emoji 🗑 (DESIGN §5).
**Desplegado** y verificado e2e: migración OK contra la BD del volumen + smoke REST completo TODO OK. Docs
(DESIGN §6.2, decisiones.md, bugs.md 2 entradas cerradas) al día. Árbol sin commit (a la espera del usuario).

2026-07-03 (fix UX · Markdown en el chat) — El texto del asistente se pintaba **plano** (`<p>{block.text}</p>`
en `AssistantMessage.tsx`): sin saltos, títulos, listas ni código. Arreglado renderizando **Markdown**:
`react-markdown` + `remark-gfm` (nuevas deps en `client`), nuevo componente `Markdown.tsx` +
`Markdown.module.css` (estilos 100% por tokens: encabezados, listas, código inline/bloque en JetBrains
Mono, citas, tablas GFM con scroll propio, checkboxes, enlaces a pestaña nueva). Sin HTML crudo (seguro)
y **sin highlighting por lenguaje** en v1 (decisión del usuario: peso en móvil). Retirada la regla `.text`
huérfana. Documentado en DESIGN §6.1 y decisiones.md. Verificado: typecheck+build verdes y render probado
con muestra (h1..h6/listas/pre/tabla/checkbox/enlace OK, sin `<script>` inyectado). Sin desplegar aún.
Trabajo directo del orquestador (Opus 4.8, sin subagentes, aprobado por el usuario §8).

2026-07-02 (consulta · terminal sin sudo / usuario node) — El usuario preguntó por qué en la vista
Terminal no hay `sudo` y sale como usuario `node`. Aclarado: el pty corre **dentro** del contenedor
`portaide-backend` (`USER node`, UID 1000 = kuoyii en el host), no es una shell del VPS; `sudo` ni
está instalado ni tendría sentido (sería root de la cajita efímera, no del host). Se debatió pasar a
**SSH / backend-en-host** para tener sudo: se descartó de momento. Conclusión fijada — **SSH no es
"más seguro"**: el transporte seguro ya lo da HTTPS/WSS; SSH solo ampliaría el blast radius de una
brecha del borde (de "cajita aislada" a "VPS entero, incluidas otras apps como smartpeak"). **Criterio
para el futuro:** si algún día se quiere sudo/host, el orden correcto es **endurecer el borde primero**
(passkey/2FA, o meter PortaIDE tras VPN Tailscale/mTLS de NPM) y **luego** abrir permisos; hacerlo al
revés dejaría peor que un SSH-con-clave. El borde actual (revisado) está decente: bcrypt 10 rounds,
comparación en tiempo constante, rate-limit 10/IP/15min. **Sin cambios de código**; se mantiene la
arquitectura v1 (decisiones.md:18).

2026-07-02 (5ª sesión · Mongo → SQLite) — El usuario cuestionó si Mongo tenía sentido para una
herramienta de un solo usuario. Análisis: lo único persistido es la **meta de las pestañas de chat**
(título/`claudeSessionId`/`cwd`/timestamps), no mensajes ni usuarios (el usuario vive en `.env`); Mongo
estaba solo por consistencia MERN con el resto del VPS. Decidido **retirar Mongo y pasar a SQLite**
(`better-sqlite3`, embebido). Ejecutor migró: `db/sqlite.ts` (nuevo, WAL + tabla `chat_sessions`)
sustituye `db/mongo.ts`; `chat/store.ts` reescrito **sin fallback en memoria** (embebido siempre
disponible; si no abre → `process.exit(1)`); modelo mongoose borrado; `env.sqlitePath`; `system`
devuelve `database:{engine,ok}`; compose sin servicio `mongo` (+ volumen `portaide_data:/app/data`);
Dockerfile crea `/app/data` con owner 1000. Cliente: `SystemInfo`/SystemPanel actualizados. Docs:
decisiones.md (entrada nueva + MERN supersedida), CLAUDE.md §2/§9. **Verificado** typecheck+build verdes
y smoke create/list/delete contra `dist`; la compilación nativa de better-sqlite3 en la imagen se
confirma en el `docker compose build` del VPS (deploy pendiente del usuario). Volumen `portaide_mongo_data`
queda huérfano en el VPS (borrable tras desplegar).

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

## 2026-07-31 — Fix: botón del selector de carpeta tapado por la barra inferior

En `bottombar`, el footer con "Open this folder" (morado) del `FolderPicker` quedaba **bajo la barra
de navegación** y no se podía pulsar en móvil. Causa: el overlay (`z-index:100`) estaba atrapado en el
contexto de apilamiento de `.viewport` (z-index:10) dentro de `.shell`, mientras la `BottomBar`
(z-index:50) y el drawer (60) pintan en el contexto raíz. Fix: el `FolderPicker` ahora se renderiza con
`createPortal(..., document.body)` y su overlay sube a `z-index:200` → el modal (scrim + footer) queda
por encima de la barra. Typecheck verde. Sin commit ni deploy.

## 2026-07-31 — Migración a "backend en el host" (repo hecho; falta ejecución en host)

Raíz de la petición: el usuario quería "usar el VPS entero desde la app" (y no poder desplegar desde
PortaIDE). Se descartó SSH (PortaIDE vive en el mismo VPS → SSH a sí mismo). Decisión (ADR 2026-07-31):
**backend al host como systemd, frontend sigue en Docker**. Cambios de repo: `docker-compose.yml`
(solo frontend + `extra_hosts` host-gateway), `client/nginx.conf` (`/api` y `/ws` → `host.docker.internal:4100`),
`server` (nuevo `HOST` env), `deploy/portaide-backend.service`, `scripts/deploy.sh`, `deploy/README.md`,
`.env.example`. Terminal y chat SIN cambios (el pty en el host ya es la shell real de kuoyii). Typecheck
verde. Falta lo del host (Tailscale, systemd, UFW, rebuild) → `deploy/README.md`. Sin commit ni deploy.

## 2026-08-01 — Historial del engine (conversaciones del VPS) cableado en la UI

El usuario no veía en el panel de historial sus conversaciones de Claude Code del servidor (transcripts
`.jsonl` de `~/.claude/projects`). Diagnóstico: el **backend ya existía y estaba verificado** (ADR
2026-07-06: `GET /api/chat/engine/sessions[?cwd]` y `.../:id`, montados en `app.ts`) pero la **UI nunca
se cableó** (quedó bloqueada por el cliente sin `attach/snapshot`, resuelto en la 8ª sesión). El panel
solo pedía `/api/chat/sessions?scope=all` (SQLite = solo sesiones nacidas en PortaIDE). Cableado en Modo
Directo: `chatStore` (`fetchEngineHistory(cwd)` + `openEngineSession` que materializa el transcript en
SQLite vía upsert y hace `attach` → repinta y reanuda con `resume`; `fetchHistory` ahora expone
`claudeSessionId` para dedup), `useChatSession`, `ChatView` (pasa el `workspace` como cwd), `ChatHistory`
(+ CSS): panel en 2 secciones **PortaIDE** / **En el servidor · Claude Code**, dedup por
id+claudeSessionId. Sin tocar el backend. Typecheck + build verdes. Sin commit ni deploy (falta QA en
dispositivo tras desplegar en el host).
