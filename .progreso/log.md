# Log — historial de todo

> Entradas cronológicas (más reciente arriba). Anota qué se hizo en cada sesión.

---

2026-10-29 (**Commit único + deploy**) — A petición del usuario: un solo commit en `staging` con todo lo
pendiente (visor PDF/HTML + guard cross-site, descargas PWA de la 19ª, explorer de la 20ª, pegar en
Terminal). Sin push. Frontend redeployado por Docker; backend reiniciado (kill -TERM → systemd). Smoke OK
por el nginx (health, preview 404 con token falso, 401 sin cookie, 403 cross-site). Falta QA en iPhone.

2026-10-29 (**Editor: visor de PDF + vista previa de HTML**) — Petición: "necesito poder previsualizar
archivos como html y pdf". **Modo Directo.** PDF con pdf.js (build legacy, carga perezosa, canvas por
página con liberación de memoria, zoom por botones). HTML con segmented Código|Vista → `<iframe sandbox>`
de origen opaco + token de capacidad para sus assets relativos (`server/src/fs/preview.ts`). Endurecido el
borde: API y WS rechazan cross-site/`Origin: null` (`auth/site.ts`); `/raw` con CSP sandbox. Dep nueva
`pdfjs-dist`. DESIGN §7.2 + ADR. **Verificado:** typecheck + build + E2E Chromium 45/45. **Sin commit ni
deploy.** Falta QA en iPhone.

2026-10-29 (**Fix: el explorer recuerda carpetas abiertas al cambiar de vista**) — Petición: "si abro una
carpeta en Files, me voy a otra pestaña y vuelvo, la tengo cerrada". **Modo Directo.** Causa: AppShell
desmonta la vista y la expansión vivía en `useState` del `TreeNode`. Fix: `views/Files/treeCache.ts` (estado
de módulo: carpetas expandidas + último listado + scroll); el árbol se pinta al instante desde la caché y
revalida en silencio; `FilesView` restaura el scroll. **Verificado:** typecheck + build verdes. DESIGN §8 y
ADR 2026-10-29 al día. **Sin commit ni deploy.** Falta QA en iPhone.
Mismo día, segundo fix: **no se podía pegar en la Terminal desde el móvil** (el textarea de xterm está
oculto → sin menú "Pegar"). Tecla `paste` en la KeyBar: `clipboard.readText()` en el click → `term.paste()`
(bracketed paste). Typecheck + build verdes. DESIGN §9 + ADR. Falta QA en iPhone.

2026-10-27 (**Fix: descargar archivos/carpetas en la PWA de iOS**) — Petición: "descargar carpetas no hace
nada" + "al descargar un archivo la app se queda atascada y hay que reabrirla". **Modo Directo** (bug fix
acotado). Causa: la descarga era un `<a download>` que **navega la página**; en PWA `standalone` iOS el
webview no tiene gestor de descargas ni botón atrás → carpeta (zip) se traga el toque, archivo deja la app
atascada. Fix: componente `DownloadLink` + helper `api/download.ts` que **no navega**: fuera de la PWA deja
el `<a download>` nativo (streaming); en standalone trae el recurso por `fetch` (misma cookie) y lo entrega
por **Web Share API** ("Guardar en Archivos"), con spinner mientras carga. Se cablean Files (`FileTree`) y
las 4 descargas del Editor. **Verificado:** typecheck + build verdes. DESIGN §7.1/§8 y ADR 2026-10-27 al
día; compromiso (RAM del zip + transient activation) en `bugs.md`. **Sin commit ni deploy.** Falta QA en
iPhone (PWA): descargar un archivo (no debe atascar la app) y una carpeta (hoja "Guardar en Archivos").

2026-08-04 (**Source Control: git desde la UI**) — Petición: commit/push/pull sin terminal. **Modo Directo**
(autorizado tras el protocolo del botón rojo). Se escribió **DESIGN §8.1** antes de tocar código. Backend
nuevo `server/src/git/` (`service.ts` sobre el binario `git` con `execFile` + `--porcelain=v2 -z`;
`routes.ts` con 8 endpoints bajo el gate de auth) y cliente `api/git.ts` + `useGitStatus` + **panel
`SourceControl`** (hoja inferior) + **chip de rama** en Files + **marcas M/A/?/D** en el árbol. Token de
GitHub (`GITHUB_TOKEN`, ya puesto por el usuario en `.env`) inyectado por env a un *credential helper*
efímero — nunca en argv, en `.git/config` ni al cliente. Alcance sin nada destructivo (`pull --ff-only`,
sin force/reset/stash/conflictos). **Verificado:** typecheck + build verdes, **39 pruebas reales** del
módulo (incluido un `fetch` autenticado real contra GitHub) y **19 smoke HTTP** contra el server levantado.
**Sin commit ni deploy.** ADR en `decisiones.md`.

2026-08-06 (**Chat: techo de render del hilo — la PWA se reiniciaba al volver a la vista**) — Síntoma:
"estoy en Chat, cambio de pestaña, vuelvo y la app peta / se reinicia" (splash) en el iPhone. Causa medida
contra `data/portaide.db`: `AppShell` remonta la vista (`key={view}`) y el hilo se pintaba **sin techo** —
la conversación mayor son 3.673 eventos → **~46.000 nodos DOM** reconstruidos de golpe, y el WebView de iOS
muere. **Ecosistema de subagentes autorizado** (2 ejecutores + revisor). Escrito **DESIGN §6.7** antes del
código: **ventana de 120 bloques** (presupuesto DURO, recortando el primer item por su cola — un turno
entero es UN item, hay uno de **576 bloques**), botón `▲ Mostrar mensajes anteriores` (+120, conserva la
posición de lectura, sin animar la entrada), **techo por card** (diff 24 líneas, bash 16, `⋯ N líneas más`),
`AssistantMessage` memoizado, ventana **congelada mientras lees**, reset del presupuesto **en fase de
render** y el hilo + composer **fuera del pull-to-refresh** (`data-ptr="off"`; arrastrar hacia abajo en el
hilo recargaba la app: segunda vía al mismo síntoma). El `revisor` **rechazó la 1ª entrega** con un crítico
correcto: la ventana contaba **por mensajes** y no acotaba nada, y la medición que la avalaba era **falsa**
(el script troceaba los items en `assistant_done`, que NO cierra el item). Corregido y re-medido con la
`threadWindow` **extraída del propio archivo**: **120 bloques exactos**, **46.047 → 2.538 nodos** (18×).
`typecheck` + `build` verdes. **Sin commit ni deploy.** ADR en `decisiones.md`, flecos en `bugs.md`.

2026-08-04 (**Chat: ancla de proyecto por conversación**) — El usuario pidió que el chat diga **a qué
proyecto pertenece** y poder cambiar la carpeta desde ahí, **solo en conversaciones no iniciadas**. El chip
`@…` mostraba el workspace global y el `cwd` viajaba por mensaje: cambiar de carpeta en Files movía de
proyecto todos los chats, también los que ya tenían hilo. Ahora el `cwd` es de la conversación: lo fija el
**primer turno** en el servidor (`SessionRuntime`, que después ignora el `cwd` de los mensajes y lo publica
en el `snapshot`), se persiste en SQLite (`PATCH cwd` validado con el nuevo `resolveDirSafe`) y el chip lo
pinta — como **botón** que abre el `FolderPicker` mientras el hilo está vacío, con **candado** en cuanto
arranca. `FolderPicker` extraído a `components/`. DESIGN.md §6.6 + ADR del 2026-08-04. Verificado con
pruebas reales contra SQLite y contra el `SessionRuntime` (puente stubbeado). Sin commit ni deploy.

---

2026-08-01 (**análisis del borde de seguridad · sin tocar código**) — El usuario preguntó si necesita la VPN
de Tailscale en el iPhone para usar PortaIDE. Respuesta: **no** — se confirmó (entra por datos móviles y desde
un iPad sin Tailscale, con URL pública + login) que el **modelo de acceso real es PÚBLICO + TLS(NPM) + auth**,
no Tailscale (que nunca se cableó como borde). Análisis en modo lectura del borde: la **auth de código está
bien** (cookie httpOnly+Secure+SameSite, bcrypt en tiempo constante, rate-limit en login, gate `requireAuth`,
upgrade de WS validado antes de abrir el socket). Los **riesgos son de postura**: un solo factor guardando un
shell completo del VPS con `bypassPermissions` (sin 2FA), contraseña débil pendiente, y dos ítems del host sin
verificar desde el repo (**UFW cerrando el 4100** y **Force-SSL en NPM**). Anotado como ADR en decisiones.md.
Recomendación: seguir en público pero endurecer (contraseña fuerte + 2FA/Cloudflare Access + UFW + Force-SSL).

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

## 2026-08-01 — Fix: barra de teclas del Terminal tapada por el teclado del móvil

El usuario, en Terminal, no veía la `KeyBar` (esc/ctrl/…) al escribir: quedaba **detrás del teclado del
sistema**. Causa: el marco (`AppShell .shell`, `position: fixed; inset: 0`) no se encoge al abrir el
teclado (decisión deliberada del shell), así que el teclado tapa el borde inferior donde vive la barra.
Fix en **Modo Directo** (scoped al Terminal, sin tocar la shell global): nuevo hook `useKeyboardInset`
(`client/src/hooks/`) que publica `--kb-inset` en `<html>` con el solape del teclado vía
`window.visualViewport` (rAF + umbral 80px; no-op si no hay soporte). La vista Terminal lo consume:
`.view` reserva `padding-bottom: var(--kb-inset)` (sube la columna; `.panes` reajusta solo por el
`ResizeObserver`+`FitAddon` ya presentes) y la `.keybar` descuenta ese solape de su holgura nav/safe-area
(`max(0, nav+safe - kb)`). Token `--kb-inset: 0px` añadido a `tokens.css`. Descartado
`interactive-widget=resizes-content` (Safari iOS no lo soporta). Detalle y alternativas en ADR 2026-08-01
de `decisiones.md`. Typecheck + build verdes. **Sin commit ni deploy** (falta QA en dispositivo).

## 2026-08-01 — Fix: backspace mantenido no se repite en el Terminal (iOS)

El usuario, en Terminal, al mantener pulsado el borrado del teclado del iPhone, borraba de uno en uno en
vez de repetir. Causa: iOS **no emite `keydown` repetidos** para el teclado virtual (a diferencia del
escritorio); el primer toque sí llega y xterm borra un carácter, pero la pulsación mantenida se queda
muda (el auto-repeat nativo de iOS solo actúa sobre contenido editable real, y el textarea de xterm está
vacío). Fix en **Modo Directo** (`TerminalPane.tsx` + `keys.ts`): helper `attachBackspaceRepeat` sobre
`term.textarea` — al primer `keydown` de Backspace (xterm ya borró ese carácter) programa, tras 400ms, el
reenvío de `DEL` (`\x7f`) cada 55ms hasta `keyup`; con tope de 500 por si se pierde el keyup. **Solo en
puntero grueso** (móvil) y **solo si `event.repeat` es falso** (no duplica la repetición nativa de
escritorio/teclado físico). Listeners en fase de captura para no depender del orden con xterm. Constante
`SEQ.del` añadida. Detalle en ADR 2026-08-01. Typecheck + build verdes. **Sin commit ni deploy** (falta
QA en iPhone: confirmar que iOS sí emite el `keydown`/`keyup` inicial de Backspace, en lo que se apoya).

## 2026-08-04 — Chat: escribir sin esperar (cola visible) + preguntas de Claude con opciones

Dos peticiones, ambas en **Modo Directo** (el usuario autorizó solo el subagente `revisor` al cierre).

**(1) Cola.** El server ya encolaba desde la 8ª sesión; el bloqueo era de UI. Ahora el composer nunca se
bloquea (`↑` si hay texto, `■` solo con el campo vacío y turno vivo) y la cola la manda el **server** en
`snapshot`/`status` (`queue:[{localId,text}]`), así que las burbujas "⏳ En cola" sobreviven a recargar la
PWA y se pueden **cancelar** (verbo `cancel` → `SessionRuntime.cancelQueued`, solo lo que no ha arrancado).

**(2) Preguntas (`AskUserQuestion`).** Verificado contra el SDK real: esa tool **sí** pasa por `canUseTool`
incluso en `bypassPermissions`, y se responde con `updatedInput.answers` (`{enunciado: respuesta}`;
multiSelect separado por ", "; admite texto libre). El Approve genérico aprobaba **sin** respuestas — por
eso el agente volvía a preguntar. Nuevos: evento `question_request`, verbo `answer`, `resolveQuestion` en
bridge/runtime y **`QuestionCard`** en el cliente (selección única/múltiple, 1–4 preguntas apiladas, "Otro…"
con texto libre, envío deshabilitado hasta responderlas todas). DESIGN.md §6.4 y §6.5 escritos ANTES de
implementar. De paso, las resoluciones entran al log: aprobar/responder y recargar ya no repinta la card
como pendiente.

Verificado: typecheck + build verdes, y **tres pruebas reales contra el engine** (sondas del SDK, puente
compilado respondiendo 2 preguntas single+multi, y runtime encolando/cancelando: el cancelado nunca se
ejecutó). **Sin commit ni deploy**; falta QA en el iPhone.

**Revisión (mismo día).** El `revisor` (autorizado por el usuario) encontró 2 altos reales y varios medios;
corregidos y re-verificados con sondas: (1) interrumpir con una pregunta viva no dejaba resolución en el
log — el deny del listener de `abort` no emitía nada, así que la card volvía accionable y responder era un
no-op mientras la UI decía "✓ respondida" → se emite, más `closeOrphanRequests()` al resucitar la sesión
desde SQLite; (2) `stop()` sin turno vivo no reemitía `status` (cola fantasma con Cancelar inútil);
(3) `cancelQueued` cancela también lo que espera slot y deja lápida contra el reenvío at-least-once;
(4) `markQuestion` reemplaza una card genérica en vez de dejarla muerta; (5) `status` sin `queue` ya no
borra la cola pintada; (6) `pendingPerm` se limpia al cerrar pestaña; (7) a11y: `role="group"` +
`aria-pressed` en vez de un `radiogroup` sin flechas; (8) CSS alineado a DESIGN §6.4/§6.5. Lo no arreglado
(slot retenido por una pregunta sin responder, entre otros) queda en `bugs.md`. Build verde.

**Corrección de rumbo (mismo día): entrega EN CALIENTE.** La cola dejaba el mensaje esperando a que
terminase el turno anterior; lo pedido era lo de Claude Code (que entre mientras trabaja). Rehecho sobre
el **streaming input** del SDK: `query({prompt: AsyncIterable<SDKUserMessage>})`, `ChatTurn.push()` +
`endInput()`, y `SessionRuntime.deliverLive()` antes de encolar (la burbuja entra al log al empujar, por
eso se ve intercalada en el trabajo). **Hallazgo crítico medido:** sin `priority: 'now'` el CLI consume el
mensaje y lo DESCARTA — con `next` o sin campo el agente terminó su tarea sin enterarse. Verificado
también que el texto llega (código `XK-7742` inyectado a mitad y escrito al final), que `resume` y `stop`
siguen bien, y que los mensajes encadenados reutilizan la misma query sin relanzar `claude` (2.7 s vs ~5 s).
La cola queda solo para lo no entregable (turno esperando slot, u otro modelo/esfuerzo). Build verde.

**Revisión #2 (streaming input).** Dos altos reproducidos por el `revisor`, corregidos y re-verificados con
sondas: (a) cerrar el canal contando `result`s era un supuesto FALSO —el CLI funde en un turno los mensajes
que llegan juntos—, así que el turno retenía su slot y el proceso `claude` **30 s** de más (typing puesto,
push tardío); ahora el cierre depende de que el CLI haya **recogido del canal** (`pending()===0`) y el
margen baja a 3 s → medido idle a **0,4 s** del último evento; (b) escribir con una card de permiso o una
pregunta abierta las marcaba **"✕ Rejected"** sin que el usuario rechazara nada → `reason:'user'|'interrupted'`
y **⚠ Interrumpido** en `--yellow`. Además: `onDropped` avisa en el hilo si un mensaje inyectado muere con
el turno; el **permissionMode** entra en `compatibleWithTurn` (podía ejecutar con bypass algo recién puesto
en Ask, §11); `setModel`/`setPermissionMode` sincronizan el estado del turno; el hilo no pinta tramos de
asistente vacíos; `feedNextOrClose` saca de la cola antes de difundir; `startTurn` no arranca durante el
shutdown. DESIGN §6.4/§6.5 actualizados (incl. que inyectar CORTA la tool en vuelo). Build verde.

## 2026-08-05 — Incidente de despliegue: la entrega en caliente estaba escrita pero NO corriendo

**Síntoma del usuario:** "cuando mando un mensaje mientras me está respondiendo, no se tiene en cuenta al
momento; me lo responde cuando termina con el mensaje previo".

**No era un bug de código.** El backend del host (`systemd portaide-backend`) llevaba vivo desde el
**1-ago 18:04**, ejecutando en memoria el código de `HEAD` (`23419bd`), que encola:
`const busy = this.turn !== null || this.accepted.size > 0; if (busy) { this.queue.push(msg) }`.
La entrega en caliente (12ª sesión, 4-ago) estaba en el árbol y hasta **compilada en `dist/`** (4-ago
17:14), pero **el servicio nunca se reinició**. El frontend sí se había reconstruido (4-ago 20:09), así
que el sistema corría con **cliente nuevo contra backend viejo**: el composer dejaba escribir y enviar
(sin bloqueo) y el servidor lo metía en cola — exactamente el síntoma descrito.

**Acción:** `npm run typecheck` (verde) → `npm run build` en `server/` → reinicio del servicio. Sin sudo
disponible en la sesión, el reinicio se hizo con `kill -TERM` al PID (el unit corre como `kuoyii` con
`Restart=always`, 2 s): systemd lo relanzó (`NRestarts=1`, PID 3982645, `/api/health` 200).

**Verificado con sonda real contra el bridge compilado** (`dist/chat/bridge.js`): turno largo de 12 pasos
Bash, `push()` a los 8 s → el agente **abandona la tarea y responde a los 15,1 s tras 1 de 12 pasos**,
reutilizando la misma query (mismo `session_id`, sin `resume`). Primera sonda descartada: el sandbox del
CLI **bloquea `sleep 25 && echo …`**, así que el turno acababa a los 6 s y no medía nada — anotado por si
se reusa el patrón.

**Lección operativa:** `scripts/deploy.sh` **sí** hace build + `systemctl restart` + rebuild del frontend.
Lo que falló fue saltárselo: un `docker compose up -d --build` solo toca el frontend, y un `npm run build`
suelto deja el `dist/` nuevo con el proceso viejo en memoria. **Desplegar siempre con `scripts/deploy.sh`**;
si se hace a mano, el `systemctl restart portaide-backend` no es opcional.

## 2026-08-05 — Preguntas de Claude (`AskUserQuestion`): la card estaba muerta por la misma desalineación

**Síntoma del usuario:** "las preguntas que me hace Claude no tengo manera de responderlas".

**Causa: la misma raíz que la entrada anterior de hoy** (cliente nuevo, backend viejo), vista desde otro
síntoma. El frontend desplegado (4-ago 15:16) ya tenía `QuestionCard`, pero el backend en memoria no emitía
`question_request` ni entendía el verbo `answer`; sin `requestId` la card cae al modo lectura
(`QuestionCard.tsx:45`) y se pinta **"Sin responder", sin botones**. Detalle a recordar: `markPending` (el
del `permission_request` genérico) **no** rehabilita un bloque `question`, así que un backend que mande el
permiso en vez de la pregunta deja igualmente la card muerta.

**Pista falsa que costó descartar:** el journal repite
`[CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] canUseTool will not be invoked: permissionMode 'bypassPermissions'…
use a PreToolUse hook instead`. Es genérico y **NO aplica a `AskUserQuestion`**: sonda contra el SDK
**0.3.198** → la tool sí invoca `canUseTool` en bypass y se responde con `updatedInput.answers`
(`tool_result: "Your questions have been answered…"`). El puente no necesita hooks.

**Acción:** build de server y client + **rebuild del frontend** (`docker compose up -d --build frontend`).
El reinicio del backend ya lo había hecho la sesión paralela (PID 3982645, 22:51). Con esto el bundle
servido incluye también el trabajo de las sesiones 13 y 14 (chip `@carpeta`, panel Source Control).

**Verificado end-to-end por el camino real de la app:** login HTTP → `ws://…/ws/chat` → `attach` +
`message` que fuerza la tool → `question_request` con sus opciones → **`answer`** → `question_answered` →
`tool_result ok` → `result success`. Más smoke autenticado (`/api/chat/sessions` 200, `/api/git/status` con
`tokenPresent: true`). La sesión de prueba se borró de SQLite; quedaron 3 transcripts de sonda en
`~/.claude/projects/` que el classifier no dejó borrar.

## 2026-08-05 — Fix: la entrega en caliente MORÍA al cerrar el canal (bug real, no solo despliegue)

Al verificar el reinicio anterior por el **camino de producción** (y no con el bridge suelto) apareció un
bug de verdad. Mecánica medida contra el CLI: al empujar con `priority:'now'`, el CLI **corta el paso en
curso y emite un `result`** que es el del turno CORTADO, no el del mensaje nuevo. `SessionRuntime.onEmit`
reacciona a ese `result` con `feedNextOrClose()` → `endInput()` → `closeInput()` cerraba el canal **justo
cuando el agente iba a atender la inyección**. Dos de dos sondas: mensaje pospuesto al final de la tarea
(43,6 s) o **perdido en silencio** —ni siquiera por `onDropped`, porque el CLI ya lo había recogido del
canal—. Explica el síntoma del usuario incluso con el código nuevo corriendo.

**Fix en `bridge.ts`:** `injectedLive` (+ `resultsSincePush`). Mientras hay una inyección sin atender,
`closeInput()` aplaza con `INJECTED_GRACE_MS` = 20 s en vez de cerrar (tras el corte el CLI puede callarse
>10 s). El **1er** `result` tras el push no levanta el bloqueo (es el del corte); del **2º** en adelante sí,
y el cierre vuelve al camino rápido, así que el slot se sigue liberando en ~0,5 s. El flag se actualiza
ANTES del `send` porque el runtime llama a `endInput()` de forma síncrona. Turnos sin inyección: idénticos.

**Sondas (4, contra el engine real, con `endInput()` en cada `result` como hace el runtime):** sin fix 2/2
mal; con fix el mensaje entra siempre y, con una orden real de parar a mitad, el agente **acusa 1,6 s
después del envío y corta en el paso 2 de 12** (turno cerrado 0,6 s más tarde). Matiz anotado: ante un
«ignora lo anterior» el modelo a veces prefiere terminar lo que estaba haciendo — decisión del modelo, no
retraso del transporte. Build verde; backend reiniciado (PID 3998591, health 200).

## 2026-10-23 — FS: ver imágenes inline + descargar archivos y carpetas (zip)

Modo Directo (botón rojo → "No"). Pedido: ver/descargar imágenes y descargar carpetas enteras.

Backend (`fs/routes.ts`): `GET /api/fs/raw` (archivo crudo en streaming, MIME por extensión, inline +
nosniff, tope inline 25 MB → 413) y `GET /api/fs/download` (attachment: archivo tal cual o **carpeta → zip**
al vuelo con `archiver`, streaming sin tope, Content-Disposition RFC 5987). Ambos bajo `requireAuth` y por
`resolveSafe` (traversal → 400). Dep nueva `archiver@^7` + `@types/archiver@^6` (el 8 rompe el default
import); zip, no tar.gz, porque el host no tiene `zip` y por iOS. Cliente: `isImagePath/fsRawUrl/fsDownloadUrl`
en `api/client.ts`; Editor pinta imágenes con `<ImagePreview>` desde `/raw` (+ botón Descargar; binario
415 → estado `binary` con descarga); FileTree con acción `⤓` por fila (archivo/carpeta). DESIGN §7.1 y §8.

Verificado: typecheck + build verdes; harness de runtime 19/19 (MIME y bytes exactos, zip con estructura
anidada vía `unzip`, traversal bloqueado, tope inline vs descarga sin tope). Sin commit. Nota: el server
estaba instalado en modo prod (sin devDeps) → `npm install --include=dev` para compilar.

## 2026-10-23 (cont.) — Deploy de la feature FS

Commit `3da5116` en staging + push a origin/staging (snapshot: incluye la WIP previa sin commitear —
Source Control §8.1 y techo de render §6.7). Frontend redeployado por Docker (portaide-frontend Up con
bundle nuevo; cae también el rebuild pendiente de la 17ª). Backend reiniciado vía proceso DETACHED
(`kill -TERM` al PID del backend; systemd Restart=always respawnea con el dist nuevo) porque la sesión
corría dentro del propio backend y sudo pide contraseña. QA en iPhone pendiente (abrir/descargar imagen,
descargar carpeta zip).
- **2026-10-29 (22ª)** — Editor: pasar de imagen sin volver a Files. `ImageViewer` (swipe horizontal +
barra `n / N ‹ ›` + flechas; imágenes de la misma carpeta; precarga ±1 como blobs) y `replaceFile` para que
la pestaña se mueva. DESIGN §7.1 + ADR. Typecheck/build verdes, E2E Chromium móvil 31/31. Sin commit/deploy.
