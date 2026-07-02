# Decisiones — ¿por qué se hizo así?

> ADR ligero. Una entrada por decisión relevante. Formato: fecha · decisión · motivo · alternativas descartadas.

---

### 2026-07-02 · Reutilizar el harness de SmartPeak

- **Decisión:** el sistema de trabajo (agentes explorador/ejecutor/revisor, skills de diseño,
  carpeta `.progreso/`, `scripts/init.sh`, estilo de `CLAUDE.md`/`DESIGN.md`) se **clona de SmartPeak**
  (`../smartpeak`) y se adapta a PortaIDE.
- **Motivo:** es un flujo ya probado por el usuario; ahorra montarlo de cero y mantiene consistencia
  entre sus proyectos.
- **Alternativas descartadas:** empezar el harness de cero (más trabajo, sin ganancia).

---

### 2026-07-02 · Arquitectura v1: servidor en el propio VPS (no puente SSH)

- **Decisión:** el backend de PortaIDE **corre en el VPS** donde vive Claude Code. Accede al
  **filesystem local**, lanza la **shell local** (`node-pty`) y lanza **`claude` local**. El móvil se
  conecta por **HTTPS + WebSocket**. La pantalla de Settings *muestra* la conexión, no la gestiona por SSH.
- **Motivo:** es lo más simple y encaja con "es donde trabajamos ahora mismo"; evita la complejidad de
  pty-sobre-SSH y gestión de claves. Confirmado por el usuario.
- **Alternativas descartadas:** puente SSH multi-VPS (más flexible pero mucho más complejo) → queda
  como **futuro** si algún día se quiere manejar varios servidores.

---

### 2026-07-02 · El chat se apoya en el CLI `claude` (no se reimplementa el agente)

- **Decisión:** el chat de PortaIDE **replica Claude Code** y para ello **lanza el binario `claude`**
  ya instalado en el VPS, en modo no-interactivo con salida en streaming, y **parsea los eventos**
  (mensajes, thinking, tool-use: Read/Edit+diff/Bash) para pintarlos en la interfaz. Desde la UI se
  debe poder **cambiar de modelo**, usar **slash-commands** y gestionar el **permission mode**, como en
  el propio Claude Code.
- **Contexto:** en el VPS existe el alias **`clauded` = `claude --dangerously-skip-permissions`**.
- **Motivo:** reutiliza la instalación existente y toda la capacidad del agente sin reescribirla.
- **Alternativas descartadas:** integrar el **Claude Agent SDK (TS)** en el server (más control, pero
  otra integración a mantener) → posible futuro si el CLI se queda corto.
- **Pendiente:** el **modo exacto de invocación** (banderas de streaming, gestión de sesión/continuación,
  mapeo fino evento→UI, cómo se cambian modelo/permmode en caliente) está **por cerrar**; anotarlo aquí
  cuando se decida en implementación.

---

### ~~2026-07-02 · Sin base de datos en v1~~ — SUPERSEDIDA (mismo día, ver siguiente entrada)

- ~~**Decisión:** v1 **no** monta una base de datos.~~ El usuario decidió después usar **MongoDB**
  para mantener el stack MERN común a todos los proyectos del servidor. Se conserva la entrada como
  registro del razonamiento original.

---

### ~~2026-07-02 · Stack MERN confirmado: MongoDB entra en v1~~ — SUPERSEDIDA (2026-07-02, ver "SQLite reemplaza a MongoDB")

- ~~**Decisión:** el stack es **MERN** — **MongoDB + Express + React + Node** — como el resto de
  proyectos del servidor (SmartPeak, total-grind, connectu, fichame). Mongo (imagen `mongo:7`, con
  auth, en red interna Docker) guarda **sesiones/histórico de chat y ajustes**; el estado real de los
  proyectos sigue siendo el **filesystem** del VPS.~~
- **Motivo (original):** instrucción directa del usuario; consistencia de infraestructura entre sus proyectos.
- **Nota crítica (registrada — y que acabó pesando más):** para una herramienta de un solo usuario, un
  store embebido habría bastado; se aceptó Mongo por consistencia operativa. Revisado el mismo día
  (ver siguiente entrada), esa consistencia no compensó el coste y se revirtió.

---

### 2026-07-02 · SQLite reemplaza a MongoDB (decisión del usuario)

- **Decisión:** se retira **MongoDB** y la persistencia pasa a **SQLite** (`better-sqlite3`, síncrono,
  embebido), fichero en `SQLITE_PATH` (`/app/data/portaide.db` en Docker, volumen nombrado
  `portaide_data`; `./data/portaide.db` en dev). El stack deja de ser MERN estricto: **SQLite +
  Express + React + Node**.
- **Motivo:** lo único que se persiste es la **meta de las pestañas de chat** (título,
  `claudeSessionId`, `cwd`, timestamps) — no mensajes, no usuarios (el usuario único vive en `.env`).
  Para ese volumen, un `mongo:7` (contenedor + auth + healthcheck + backup + un servicio más en el
  borde §11) es desproporcionado. SQLite embebido lo cubre con **cero contenedor, un fichero de
  backup y menos superficie de red**. La razón original (homogeneidad MERN con el resto del VPS) no
  compensó el coste para esta herramienta.
- **Qué cambió:** `db/sqlite.ts` (nuevo: `initDb()` + `getDb()`, WAL, tabla `chat_sessions`) sustituye
  a `db/mongo.ts`; `chat/store.ts` reescrito (mismas firmas `async`, **sin fallback en memoria** — al
  ser embebida SIEMPRE está; si no abre, `process.exit(1)` ruidoso); modelo mongoose eliminado;
  `env.sqlitePath`; `system` devuelve `database:{engine,ok}` en vez de `mongo:{connected}`;
  `docker-compose.yml` sin servicio `mongo`; `Dockerfile` crea `/app/data` con owner 1000 para el volumen.
- **Migración de datos:** ninguna. Las sesiones que hubiera en el volumen Mongo (solo títulos de
  pestañas) se descartan. El volumen `portaide_mongo_data` queda huérfano en el VPS y puede borrarse
  (`docker volume rm portaide_mongo_data`) tras desplegar.
- **Futuro:** si algún día hace falta multiusuario/2FA, SQLite sigue sirviendo (una tabla `users`); no
  se reintroduce Mongo salvo necesidad real de documentos/escala que hoy no existe.

---

### 2026-07-02 · Despliegue: Docker Compose + Nginx Proxy Manager (patrón SmartPeak)

> **Actualizado (2026-07-02):** ya **no hay servicio `mongo`** (SQLite embebido lo sustituye, ver
> entrada "SQLite reemplaza a MongoDB"). Ahora son **2 servicios** (`frontend` + `backend`); la cadena
> de salud es **backend healthy → frontend arranca**; el backend monta el volumen `portaide_data` en
> `/app/data` para el fichero SQLite. El resto del patrón (NPM, nginx, WS, secretos) sigue vigente.

- **Decisión:** PortaIDE se despliega como los demás proyectos del VPS: **Docker Compose detrás de
  Nginx Proxy Manager** (contenedor `npm-app`, termina TLS en 80/443 y enruta por la red externa
  `reverse_proxy_network`). Se replica el **patrón de SmartPeak**, el más maduro del servidor:
  - **3 servicios**: `frontend` (nginx multi-stage sirviendo el build de Vite, `expose 80`, redes
    `reverse_proxy_network` + `internal`), `backend` (node:20-alpine multi-stage TS, `expose`, solo
    red `internal`), `mongo` (`mongo:7` con auth root, volumen nombrado, healthcheck `mongosh ping`,
    solo red `internal`; opcionalmente `127.0.0.1:27017` para dev local).
  - **Sin `ports:` al host** (salvo el loopback de mongo para dev): NPM alcanza el frontend por
    `container_name` en la red compartida. Nombres con prefijo `portaide-*` para no colisionar en DNS.
  - **El nginx del frontend es el segundo proxy**: SPA fallback (`try_files … /index.html`), gzip,
    `/assets/` cache 1y immutable, `sw.js`/`manifest` no-cache, y `/api` + `/ws` proxyados al
    backend por **`container_name` único** (`portaide-backend`) con `resolver 127.0.0.11 valid=10s`
    + variable (evita 502 tras reinicios y colisiones con otros stacks). Mismo origen ⇒ cookies
    httpOnly sin CORS cruzado.
  - **WebSockets** (pty + chat, esto SÍ lo usa PortaIDE a diferencia de los demás): cabeceras
    `Upgrade`/`Connection "upgrade"` + `proxy_http_version 1.1` y **timeouts largos** en la ruta WS;
    en NPM, activar "Websockets Support" en el proxy host (paso manual del panel).
  - **Cadena de salud**: mongo healthy → backend healthy → frontend arranca (healthcheck del backend
    contra `/api/health` en su Dockerfile).
  - **Secretos**: `.env` en el servidor (gitignored) + `.env.example` con solo nombres.
- **Anti-patrones detectados en otros proyectos que NO se replican:** secretos inline en el compose
  (connectu), `mongo:latest`/`node:latest` sin pin, `nodemon` como CMD de producción, backend
  publicando puertos al host (fichame), mongo colgando de la red del proxy, ausencia de healthchecks.
- **Peculiaridad de PortaIDE (importante):** el backend necesita tocar el **host** (FS de
  `/home/kuoyii/servers`, CLI `claude`). Contenedorizado, eso exige **montajes profundos**:
  `/home/kuoyii/servers` bind-mounted en el **mismo path**, `~/.claude` (credenciales/config),
  `claude` CLI + git instalados en la imagen, usuario del contenedor con **UID/GID 1000** (kuoyii), y
  —si se quiere operar Docker desde la Terminal— `docker.sock` + docker CLI (precedente: Portainer ya
  corre así en este VPS). **Trade-off asumido:** la shell de la vista Terminal es la del contenedor
  (sin `systemctl` del host; herramientas = las de la imagen). **Alternativa viva:** backend como
  servicio del host (systemd) con solo frontend+mongo en Docker — cambio localizado si el contenedor
  se queda corto. En **desarrollo** el backend corre en el host (`npm run dev`), así que esto solo
  afecta al despliegue.

---

### 2026-07-02 · Libs concretas (cierra el "stack a validar" de CLAUDE.md §9)

- **Frontend:** **Vite + React + TypeScript**. **Sin Tailwind**: CSS vanilla con **custom properties**
  (los tokens de DESIGN.md) + **CSS Modules** por componente. Motivo: DESIGN.md exige "solo tokens
  `--*`, cero colores literales" y el mockup canónico ya es CSS puro — la traducción es 1:1, sin capa
  intermedia que luche contra el sistema. (SmartPeak usa Tailwind; aquí no aporta.)
- **Fuentes autoalojadas** vía **@fontsource** (`ibm-plex-sans`, `jetbrains-mono`): PWA offline-able,
  sin dependencia de Google Fonts.
- **Editor:** **CodeMirror 6** (mejor táctil/móvil y más ligero que Monaco). **Terminal:** **xterm.js**.
- **Backend:** **Express + TypeScript**, **ws** (WebSocket), **node-pty** (pty real), **better-sqlite3**
  (SQLite embebido; sustituyó a `mongoose`/Mongo — ver "SQLite reemplaza a MongoDB").
- **Monorepo sin workspaces** (patrón SmartPeak): `client/` y `server/` con `package.json` propios +
  raíz con `concurrently` (`npm run dev` levanta ambos).

---

### 2026-07-02 · Subagente `revisor` omitido cuando el orquestador corre con Fable 5

- **Decisión:** con el orquestador en **Fable 5**, el paso 4 del flujo multiagente (delegar en
  `revisor`) **se omite**: la verificación (build, tests, lectura crítica del diff) la hace el propio
  orquestador antes de dar por buena una tarea. El agente `revisor` sigue definido en
  `.claude/agents/` por si se vuelve a modelos menores.
- **Motivo:** instrucción del usuario (2026-07-02).

---

### 2026-07-02 · Autenticación v1: usuario único por env + JWT en cookie httpOnly (elección del usuario)

- **Decisión:** login por **email + contraseña de UN usuario**, definido en `.env` (`AUTH_EMAIL`,
  `AUTH_PASSWORD`). La contraseña se **hashea con bcryptjs en memoria al arrancar** (nunca en claro en
  logs ni al cliente). La sesión es un **JWT HS256** firmado con `SESSION_SECRET`, guardado en cookie
  **httpOnly + Secure + SameSite=Lax** (exp ~30 días). `app.set('trust proxy', 1)` porque NPM termina
  TLS. **Rate-limit + bloqueo** en `POST /api/auth/login`. Middleware `requireAuth` protege **todo**
  `/api` salvo `/api/health` y `/api/auth/login`; el **upgrade de WebSocket valida la cookie** y cierra
  la conexión si no hay sesión. Esto satisface la regla dura de CLAUDE.md §11 (nada de FS/pty/chat sin
  sesión) antes de exponer nada.
- **Motivo:** es una herramienta de un solo usuario; meter una colección `users` en Mongo para una
  única credencial acoplaría el **borde de seguridad** a la DB sin ganancia y añade un modo de fallo
  (Mongo caído = no login). Env es más simple, robusto y **testeable sin Mongo**. Mongo queda para
  chat/ajustes. `bcryptjs` (JS puro) en vez de `argon2`/`bcrypt` nativo para no meter build nativo en
  el borde de seguridad.
- **Usuario sembrado:** `jcollvir@gmail.com` (pass en `.env`; **débil y compartida en claro por chat —
  a cambiar cuanto antes**, anotado para el usuario).
- **Futuro:** tabla `users` en la DB (SQLite) cuando haga falta multiusuario o 2FA/passkeys.

---

### 2026-07-02 · Workspace estilo VS Code: navegar todo el server + carpeta de trabajo activa

- **Decisión:** la app navega el filesystem y fija una **carpeta de trabajo activa** (como "Open
  Folder" de VS Code) que acota Files/Editor/Terminal/Chat (es el `cwd`). Raíz navegable y workspace
  por defecto = **`/home/kuoyii/servers`** (todos los proyectos), configurable por env `FS_ROOT`.
  Guard **anti path-traversal** relativo a `FS_ROOT` en toda la FS API.
- **Límite real en Docker (importante):** el contenedor **solo ve lo montado**. v1 monta
  `/home/kuoyii/servers` (+ `~/.claude` para la auth de claude). El "acceso a **todo** el servidor" que
  pediste, de forma literal, requeriría montar más (`/home/kuoyii` o `/`) o correr el backend en el
  host. Se deja `FS_ROOT` como env para **ampliarlo en una línea** (+ nota en el informe de cierre).

---

### 2026-07-02 · Puente del Chat: Agent SDK `@anthropic-ai/claude-agent-sdk` + `canUseTool` (aprobaciones reales)

- **Decisión (elección del usuario: aprobaciones reales):** el chat usa **`@anthropic-ai/claude-agent-sdk`**
  (`query()`), con **`canUseTool`** para **Approve/Reject reales** (pausa antes de cada Edit/Bash/Write
  y espera la decisión del cliente vía WS), `includePartialMessages` para streaming → tarjetas de UI,
  `resume` para continuidad del hilo, `setModel`/`setPermissionMode` para cambiar en caliente, y
  `cwd` = workspace activo. Cierra el "detalles del puente / Agent SDK" que estaba pendiente.
- **Terminal aparte:** pty real con el binario `claude`/`clauded` (ahí escribes el comando tú). El chat
  estructurado va por SDK. Se cumplen ambas visiones (CLAUDE.md §4).
- **Auth del engine:** el usuario está logueado por **suscripción** en `~/.claude` (no hay
  `ANTHROPIC_API_KEY`). El CLI headless (`claude --print`) funciona con esa auth (verificado). El SDK
  lanza el mismo engine, así que **debería heredarla** — validado empíricamente en esta sesión.
- **Fallback si el SDK no autenticara:** puente por CLI (`claude --print --output-format stream-json
  --input-format stream-json`) con gating vía `--permission-prompt-tool` + MCP propio (más trabajo).

---

### 2026-07-02 · Despliegue e implementación de Fase 3 (notas de cierre)

- **Imagen backend `node:20-slim` (Debian/glibc), NO alpine/musl:** el binario `claude` y `node-pty`
  son más compatibles con glibc (igual que el host). Instala `claude` global (para la Terminal) + un
  wrapper real `/usr/local/bin/clauded` (más robusto que un alias de shell en contenedor). `HOME=/home/kuoyii`
  y `USER node` (uid 1000 = kuoyii) para que `~/.claude` montado y las rutas absolutas coincidan.
- **Auth del engine confirmada:** el CLI headless y el Agent SDK autentican con la **suscripción**
  (`~/.claude/.credentials.json`), sin `ANTHROPIC_API_KEY`. Verificado en local y dentro del contenedor.
- **Fix del puente (importante):** `canUseTool` del SDK **exige `updatedInput` (record)** en la respuesta
  `behavior:'allow'`; sin él lanza ZodError y la tool falla en silencio. El puente hace `updatedInput ?? input`.
- **Bash de solo-lectura NO pide permiso** (el engine 2.x lo ejecuta en sandbox sin `canUseTool`); el
  gating real aplica a Write/Edit y a Bash con efectos. No es bug.
- **Mongo:** el `docker compose up` de scaffolding (sin `.env`) inicializó el volumen **sin auth**. Al
  desplegar Fase 3 se **reseteó el volumen vacío** para que Mongo arrancara con `MONGO_INITDB_*` y el
  backend autenticara. Mongo sigue siendo **opcional** (el backend degrada a memoria si cae).

---

### 2026-07-02 · Settings v1 — qué se implementa y qué se desvía del mockup

Al ampliar Settings (antes casi un stub: solo "Account") se decidió, con el usuario:

- **"VPS Connection" del mock → NO se implementa; se sustituye por "System".** El panel del mock
  (host `91.107.204.12`, `deploy · 22`, `id_ed25519`) describe **SSH remoto**, arquitectura que v1
  **no** usa (backend en el propio VPS, §2 de CLAUDE.md). Pintarlo sería fachada que miente sobre la
  arquitectura. En su lugar, **"System"** con datos **reales** vía `GET /api/system` (autenticado):
  uptime del backend, versión de Node, versión del CLI `claude`, `fsRoot` del workspace y estado de Mongo.
- **Grupo "Claude Code" (Model / Permission mode / Auto-approve) → diferido, NO en Settings v1.** Esos
  controles ya viven en el **composer del Chat** (cambio en caliente por WS, su fuente de verdad).
  Meterlos también en Settings crearía dos estados a sincronizar. Queda como posible mejora futura
  ("defaults persistentes" en localStorage que sirvan de valor inicial al chat) si se pide.
- **Sí implementado y funcional:** **Appearance** → *Theme* (3 swatches cableados a `ThemeProvider.setTheme`;
  la infra de tema ya existía, solo faltaba el control) y *Editor font size* (stepper 11–20, nuevo
  `AppearanceProvider` con patrón hermano del `ThemeProvider`: persiste `portaide:editorFontSize` y
  aplica la CSS var `--editor-font-size`, que consume el CodeMirror en vivo).
- **Tokens de preview de tema:** los swatches necesitan mostrar el fondo/acento de **cada** tema a la vez,
  pero los tokens `--bg`/`--accent` solo existen bajo el `data-theme` activo. Por eso se añadieron tokens
  **fijos** `--bg-{theme}` y `--accent-{theme}` en `tokens.css` (mismos valores que cada bloque de tema).

---

## Pendientes de decidir (no inventar; preguntar o resolver en implementación)

- **Ampliar `FS_ROOT`** a todo el servidor (montar `/home/kuoyii` o `/`, o backend en el host) si el
  acceso solo a `servers/` se queda corto — trade-off de seguridad, decidir al usarlo.
- **2FA / passkeys** y colección `users` en Mongo: endurecer auth si el borde lo pide.
- **Multi-VPS por SSH**: si algún día se retoma, definir aquí el modelo.
