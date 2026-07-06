# Decisiones — ¿por qué se hizo así?

> ADR ligero. Una entrada por decisión relevante. Formato: fecha · decisión · motivo · alternativas descartadas.

---

### 2026-07-06 · Historial del chat: leer los transcripts REALES del engine (`~/.claude/projects`) — BACKEND

**Problema (pedido por el usuario):** el panel de historial solo listaba conversaciones creadas DENTRO de
PortaIDE (su BD SQLite). El usuario quiere ver también las de su Claude Code / VS Code del proyecto
(transcripts `.jsonl` del engine). Salía vacío porque se miraba el cajón equivocado.

**Decisiones del usuario (2026-07-06):** opción **B (repintar el hilo completo + reanudar)**; alcance
**solo el proyecto abierto**; hacerlo **en Modo Directo, sin subagentes**.

**Diseño (encaje con el SessionRuntime):** el hilo persistido ya es un **log de eventos** (`LogEvent[]` =
`OutMsg` del bridge + burbuja del usuario). El engine guarda cada sesión como `.jsonl` de mensajes API
(content blocks). Se **convierte 1:1** el `.jsonl` a ese mismo `LogEvent[]`, así el cliente lo repinta con
su ensamblado normal (sin caso especial) y se **reanuda con `resume`** usando el sessionId del engine (=
nombre del `.jsonl`). Módulo nuevo `server/src/chat/engineHistory.ts` (solo lectura) + endpoints REST
`GET /api/chat/engine/sessions?cwd=` (lista: id, `aiTitle`, fecha, rama, nº msgs) y
`GET /api/chat/engine/sessions/:id?cwd=` (transcript→`LogEvent[]`). Sanitización cwd→dir:
`replace(/[^a-zA-Z0-9]/g,'-')` (verificada). Seguridad: cwd validado bajo FS_ROOT (`resolveSafe`),
sessionId anti-traversal.

**Estado:** BACKEND hecho y verificado (typecheck+build verdes; smoke sobre transcripts reales: 18 sesiones
listadas con sus `aiTitle`, conversión a 348 eventos con tipos válidos, `tool_use`↔`tool_result` casados,
traversal bloqueado). **UI PENDIENTE:** el cableado del panel toca el cliente, que **aún no está migrado al
SessionRuntime** (ver bugs.md) — se hará cuando el cliente hable el protocolo `attach`/`snapshot`.

**Alternativas descartadas:** hidratar el runtime desde el `.jsonl` en `attach` (acoplaría `runtime.ts` al
FS del engine; REST + `upsert` es más desacoplado); mapear el transcript a los `items` del cliente
(duplicaría el ensamblado; `LogEvent[]` lo reutiliza tal cual).

---

### 2026-07-06 · Harness multiagente: el default se invierte a **Modo Directo** (subagentes = opt-in con "botón rojo")

**Decisión (pedida por el usuario).** Se invierte el default de CLAUDE.md §8. Antes: el orquestador
*coordinaba* y delegaba por defecto (explorador/ejecutor/revisor), y preguntaba antes de **saltarse**
el harness. Ahora: **por defecto el orquestador trabaja en Modo Directo** (ejecuta él mismo el cambio
y responde); desplegar subagentes es la **excepción** y requiere **autorización explícita** mía.

**Mecanismo — "Protocolo crítico de activación de subagentes" (§8).** Filtro de entrada en cada
petición: (1) por defecto Modo Directo, prohibido invocar subagentes sin permiso; (2) solo si la tarea
crea módulos/vistas desde cero, es refactor masivo de arquitectura o toca **>2 archivos** a la vez, se
detiene; (3) entonces lanza la pregunta de confirmación literal ("Patrón, …[Sí]/[No]") y bloquea hasta
respuesta. "Sí" → arnés completo; "No" → lo resuelve en el chat principal.

**Coherencia del documento.** El antiguo "Flujo de cada tarea" asumía delegación por defecto y
contradecía el protocolo nuevo. Se reordena §8: intro reformulada → protocolo (filtro de entrada) →
"Flujo cuando el arnés está activado". Se aclara que el manejo de `.progreso/` (leer al empezar,
actualizar al cerrar) **es obligatorio en ambos modos**; Modo Directo solo evita el *despliegue de
subagentes*, no exime de `.progreso/` ni de DESIGN.md.

**Motivo.** Menos overhead y latencia en tareas sencillas (la mayoría), y control humano explícito
antes de gastar contexto/tokens en el arnés. **Alternativa descartada:** mantener el default en
delegación (genera fan-out innecesario en cambios pequeños) o dejar ambas reglas conviviendo
(documento contradictorio). **Sustituye** a la antigua subsección "Cuándo saltar el harness".

---

### 2026-07-03 · Chat en segundo plano: turno del agente desacoplado del WS (`SessionRuntime`), multi-sesión, cola y push

**Problema (reportado por el usuario):** (1) solo se puede tener 1 conversación activa a la vez; (2) no se
puede escribir mientras el agente trabaja; (3) al apagar la pantalla / salir de la app el turno **muere**
(hoy el `query()` del SDK nace y muere dentro del handler de `/ws/chat`: al cerrar el socket se dispara el
`AbortController` y se pierde el turno y su buffer); (4) no hay forma de saber cuándo un chat termina.

**Causa raíz:** el turno del agente está **acoplado a la conexión del cliente**. El modelo de datos
multi-sesión ya existe (SQLite `chat_sessions`), pero el turno vivo es un **singleton de facto** (uno por
conexión en `ws.ts`; `pendingLocalId` global en `chatStore.ts`).

**Decisión — desacoplar el turno de la conexión.** Se introduce un **`SessionRuntime`** server-side que
*posee* el `query()` de cada sesión, independiente de cualquier WS. El WS pasa a ser **transporte
multiplexado** (cada trama lleva `sessionId`; una conexión atiende N sesiones). El cliente hace
**attach/detach** a sesiones y **recupera** el estado tras reconectar. Resuelve los 4 puntos de golpe.

**Decisiones del usuario (2026-07-03):**
- **Concurrencia: "sin límite" → implementado como knob.** `CHAT_MAX_CONCURRENT_TURNS` (env), **default
  `3`**, **`0` = ilimitado**. Motivo: la memoria del proyecto documenta congelaciones del VPS por saturación
  de CPU al abrir varias sesiones a la vez → "sin límite" reproduce ese bug. Se da el ilimitado literal a un
  env var de distancia, pero no por defecto. *(Discrepancia registrada; el usuario puede poner `0`.)*
- **Permisos: "sin permisos" → default `bypassPermissions`.** El default de sesión pasa a bypass (no
  pregunta, no se bloquea en 2º plano). El Approve/Reject (modo `Ask`, §4) **se conserva disponible** por
  sesión, solo deja de ser default. **Implicación §11:** bypass-por-defecto = cualquiera que cruce el borde
  ejecuta lo que sea → **cambiar la contraseña débil `joan5599` deja de ser opcional**.
- **Alcance: "todo de una"** (núcleo + push en el mismo bloque).

**`SessionRuntime` (server, singleton por `sessionId`):** posee `thread` (en memoria, fuente de verdad del
render en vivo), contador `seq`, `status` (`idle|running|queued|error`), `AbortController`, `queue: string[]`,
`subscribers: Set<ws>`, `model`, `permissionMode` (default bypass). Métodos: `enqueueMessage`,
`subscribe/unsubscribe`, `getSnapshot`, `stop`, `setModel/setPermissionMode`. **No conoce el WS**; emite a
los subscribers. *Concurrencia:* set de turnos "running" + cola FIFO a nivel de módulo; al arrancar, si
`running.size >= max` (y `max>0`) espera hueco. *Ciclo del turno:* por cada evento del bridge → asigna `seq`,
lo mete en `thread`, **broadcast** a subscribers y **persiste** (debounced, `store.upsertSession`: `thread` +
`claude_session_id`). Al terminar: persiste; si hay cola, arranca el siguiente; si **no hay subscribers** en
esa sesión (app en 2º plano) → dispara **push**. Al apagar el server: aborta todos (turnos vivos en memoria
se pierden en un redeploy; sobrevive el hilo persistido — límite asumido).

**Bridge (`bridge.ts`):** `runChatTurn` deja de escribir al `ws`; emite a un **sink (callback)** que le pasa
el runtime. El resto igual (mapeo de eventos, `canUseTool`, `resume`, `set_model/permission_mode`).

**Protocolo WS (multiplexado).** Cliente→server: `attach{sessionId}` (→ `snapshot`), `detach{sessionId}`
(**no** para el turno), `message{sessionId,localId,text}` (encola/arranca), `stop{sessionId}` (aborta),
`permission{sessionId,requestId,decision}` (modo Ask), `set_model`/`set_permission_mode{sessionId,...}`.
Server→cliente: `snapshot{sessionId,thread,seq,status,queueLength}` (el cliente **reemplaza** su estado local
y luego aplica eventos con `seq'>seq`), `event{sessionId,seq,event}`, `status{sessionId,status,queueLength}`,
`permission_request{...}`, `error`.

**Snapshot-on-attach (en vez de replay incremental):** al `attach`, el server manda el `thread` completo
autoritativo + `seq` actual; el cliente reemplaza. Evita el deduplicado por `seq` y da "ponerse al día tras
pantalla apagada" gratis. Coste: enviar el hilo entero por attach (aceptable, 1 usuario).

**Supersede parcialmente** la entrada "Chat: persistir el HILO (client-driven)" (más abajo, mismo día): como
el WS ahora **sí** conoce `sessionId`, la persistencia del hilo de un turno **vivo/en 2º plano** la hace el
**server** (el cliente puede no estar). El cliente sigue pudiendo `PATCH` meta (título); REST sigue siendo la
vía de hidratación del historial. `onSession` deja de ser no-op (el server persiste `claude_session_id`).

**Notificaciones (Web Push):** `web-push` + VAPID (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` en
`.env`). Tabla `push_subscriptions`. Service Worker `client/public/sw.js` (la ruta `/sw.js` ya está reservada
en `nginx.conf`) con `push` + `notificationclick` (enfoca/abre la app en la sesión). **Disparo:** turno
terminado/error (o permiso pendiente en modo Ask) **y** sin subscriber activo en esa sesión. Toggle
"Notificaciones" en Settings → pide permiso y registra la subscripción. **Caveat iOS:** Web Push solo en la
**PWA instalada** (añadida a inicio, iOS 16.4+), no en Safari normal.

**Alternativas descartadas:** replay incremental por `seq` con buffer en anillo (más complejo que
snapshot-on-attach para 1 usuario); turno atado al WS con grace-period de reconexión (no cubre "pantalla
apagada 10 min"); streaming-input del SDK para inyectar en el turno vivo (la cola FIFO cubre lo pedido con
menos riesgo); SSE en vez de WS (ya hay WS y multiplexar es directo).

---

### 2026-07-03 · RESTRICCIÓN A REVISAR: PortaIDE no puede desplegarse a sí misma (corre dentro del contenedor)

**Hallazgo (verificado en esta sesión):** cuando `claude` se ejecuta **a través de PortaIDE**, corre
**dentro del contenedor** de la app (hostname tipo `0b55754400ed`, existe `/.dockerenv`) y ese contenedor
**no tiene el binario `docker` ni el socket** (`/var/run/docker.sock` no está montado). Por tanto, **desde
el chat o la terminal de PortaIDE NO se puede ejecutar `docker compose up -d --build`** ni ningún comando
docker. Lo mismo aplica a la Terminal de la app (mismo contenedor). Los deploys de sesiones anteriores
funcionaron porque corrían en una **sesión sobre el host** del VPS, no vía PortaIDE.

**Implicación:** el ciclo "editar → desplegar" no se cierra desde dentro de la app. El código sí llega al
host (el repo `/home/kuoyii/servers/portaide` está bind-montado), pero el `docker compose` hay que lanzarlo
**en el host** (SSH directo o una sesión de Claude sobre el host).

**A decidir (pendiente):** cómo dar a PortaIDE capacidad de auto-desplegarse si se quiere. Opciones a
sopesar — **montar el `docker.sock`** en el contenedor (rápido pero **eleva mucho el riesgo de seguridad**:
acceso a docker = root efectivo en el host; choca con §11), un **endpoint/agente de deploy en el host** que
la app dispare (un webhook/cola que el host observe), o **dejarlo como está** (deploy manual en el host, es
una herramienta de un solo usuario). Por defecto, hasta decidir: **el deploy es una acción del host**.

**Alternativas descartadas (de momento):** ejecutar docker dentro del contenedor (imposible sin binario/socket).

### 2026-07-03 · Navegación: se retira la isla flotante → drawer `☰` (por defecto) + barra inferior (alternativa)

Se **retira la isla de navegación flotante** y se sustituye por **dos modos intercambiables** desde
Settings → Appearance:

- **(a) Drawer con hamburguesa `☰` (por defecto)**: botón `☰` en la cabecera de cada vista → panel lateral
  que desliza desde la izquierda sobre un scrim.
- **(b) Barra inferior fija (alternativa)**: barra `position: fixed` con los 5 destinos.

**Esto INVIERTE CLAUDE.md §3 / DESIGN.md §5** (que decían "no tab bar clásica; isla dinámica"). **Motivo**:
la isla flotante (flota sobre el contenido, se recoloca sola, es arrastrable) no se integra con el
contenido y es poco predecible; un drawer `☰` y una barra inferior son **patrones nativos y predecibles**.
La preferencia `navMode` se persiste en `localStorage: portaide:navMode` (default `drawer`) y el modelo de
clearance pasa a la var `--nav-inset` (0 en drawer, alto de la barra en bottombar) en lugar de `--fab-clear`.

- **Alternativas descartadas**: mantener la isla (rechazada por el usuario: poco predecible); solo drawer o
  solo barra (se ofrecen ambos y el usuario elige).

### 2026-07-03 · Chat: persistir el HILO + historial (cerrar ≠ borrar), rehidratación con `resume`

Para que al recargar NO se pierda el chat y exista historial de conversaciones:

- **Se persiste el HILO** de cada conversación como blob JSON (`thread`) en `chat_sessions` (antes solo
  meta). Motivo: al recargar hay que **repintar** las burbujas/tool-cards idénticas; confiar solo en el
  `resume` del engine rehidrata el contexto de Claude pero deja el hilo **visual vacío** (mala UX, justo
  el síntoma reportado). El server guarda `thread` como TEXT **opaco** (no entiende su forma); la fuente
  de verdad del render es el cliente (`chatStore.items`), que lo emite por `PATCH`.
- **Identidad de sesión = UUID generado por el CLIENTE**; el backend hace `PATCH /sessions/:id` en modo
  **upsert** (crea si no existe). Elimina la reconciliación frágil id-local→id-server del código previo y
  sus races durante el streaming.
- **Persistencia client-driven**: el WS `/ws/chat` es por-conexión y NO conoce el id de la pestaña, así
  que el `claudeSessionId` (evento `session`) lo persiste el **cliente** vía `PATCH`, no el server
  (`onSession` sigue siendo no-op a propósito).
- **Modelo pestañas ≠ historial** (elección del usuario): flag `open`. La `×` **cierra** (`open=false`,
  sigue en historial); **borrar** es `DELETE` explícito desde el panel. Pestañas ordenadas por
  `created_at ASC` (estables); historial por `updated_at DESC`.
- **Rehidratación lazy**: al montar se cargan las pestañas abiertas (meta) + el hilo de la **activa**
  (`GET /sessions/:id`); las demás se cargan al enfocarlas. `activeId` se persiste en localStorage.
- **Endpoints**: `GET /sessions?scope=open|all`, `GET /sessions/:id` (con `thread`), `PATCH /sessions/:id`
  (upsert). Límite del body a 5 MB (hilos con diffs).
- **Alternativas descartadas**: tabla normalizada `chat_messages` (perdería la riqueza de tool-cards/diffs
  sin modelar todo); solo `resume` sin persistir mensajes (hilo visual vacío al recargar); persistir
  server-side desde el WS (no conoce el id de la pestaña).

### 2026-07-03 · Render de Markdown en el chat: `react-markdown` + `remark-gfm`, sin highlighting por lenguaje

El texto del asistente se mostraba plano. Se renderiza ahora con **`react-markdown` + `remark-gfm`**
(deps nuevas en `client`), estilado 100% por tokens en `Markdown.tsx`/`Markdown.module.css`.

- **Por qué react-markdown**: estándar en React, seguro por defecto (no interpreta HTML crudo salvo
  `rehype-raw`, que NO añadimos), tipos incluidos, compatible con React 19. GFM (tablas, tachado,
  autolinks, checkboxes) vía `remark-gfm`.
- **Sin syntax highlighting por lenguaje en v1** (decisión del usuario): los bloques van monoespaciados
  (JetBrains Mono) sobre `--surface` con borde, sin colorear la sintaxis. Motivo: **peso del bundle en
  móvil** (highlight.js/shiki añaden bastante). Se puede subir después con `rehype-highlight` mapeando
  el tema a los tokens de highlight ya definidos en DESIGN §3. Coste asumido: menos fidelidad al Claude
  Code real, que sí colorea el código.
- **Alternativas descartadas**: `marked`/`markdown-it` + `dangerouslySetInnerHTML` (superficie XSS
  innecesaria); shiki (pesado para móvil); CodeMirror para render de code blocks (overkill para texto no
  editable).
- **Nota de streaming**: el bloque se re-parsea en cada delta (el componente va en `memo` para no tocar
  bloques anteriores); un fenced block a medio cerrar se ve raro mientras streamea y se resuelve al cerrar.
  Aceptable en v1. Spec visual en DESIGN §6.1.

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
- **Revalorar SSH / backend-en-host (2026-07-06, reabierto por el usuario)** — dado que **todo corre
  DENTRO del contenedor** (sin `docker`/socket → no auto-deploy; Terminal = shell del contenedor sin
  `sudo` ni acceso real al host; FS limitado a lo montado), sopesar mover a un modelo con acceso al host:
  **(a)** backend como servicio del host (systemd) con solo frontend en Docker — cambio localizado, ya
  citado como "alternativa viva" en el ADR de despliegue; **(b)** puente SSH del contenedor al host.
  **Veredicto previo sigue en pie** (log 2026-07-02 + ADR "RESTRICCIÓN A REVISAR" abajo): esto es un
  argumento de **capacidad/DX, no de seguridad** — SSH/host **no es más seguro**, amplía el *blast radius*
  de una brecha del borde de "cajita aislada" a "VPS entero (incl. smartpeak y demás)". Si se prioriza la
  capacidad, el **orden correcto** es endurecer el borde primero (2FA/passkey, o VPN Tailscale/mTLS en NPM)
  y **luego** abrir permisos. Decisión pendiente del usuario.
