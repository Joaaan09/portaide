# Decisiones — ¿por qué se hizo así?

> ADR ligero. Una entrada por decisión relevante. Formato: fecha · decisión · motivo · alternativas descartadas.

---

### 2026-08-01 · UI del historial del engine cableada (cierra el "UI PENDIENTE" del ADR 2026-07-06)

**Contexto (usuario):** con Tailscale + backend-en-host ya en marcha, seguía sin ver "las conversaciones
que tengo en el servidor". No era transporte: el **backend del historial del engine ya estaba hecho y
verificado** (ADR 2026-07-06) pero su UI quedó a medias porque en su día el cliente no hablaba
`attach/snapshot`. Ese bloqueo se levantó en la 8ª sesión, así que solo faltaba el cableado.

**Decisión (Modo Directo, sin tocar el backend):** el panel de historial pasa a **2 secciones** —
**PortaIDE** (SQLite, `scope=all`, como estaba) y **En el servidor · Claude Code** (transcripts del
engine del proyecto abierto, incl. las de VS Code). El engine es **por proyecto** → la sección usa el
`cwd` del workspace activo; sin proyecto, hint. **Dedup** de la sección del servidor por
`id ∪ claudeSessionId` de las sesiones de PortaIDE (toda conversación nacida en PortaIDE también deja
un `.jsonl`, si no se filtraría duplicada).

**Cómo se abre una sesión del engine (encaje con el `SessionRuntime`):** `openEngineSession` descarga el
transcript ya convertido a `LogEvent[]` (`GET …/engine/sessions/:id?cwd`), lo **materializa en SQLite**
(`PATCH /sessions/:id` upsert con `thread` + `claudeSessionId`, **reusando el sessionId del engine como
id de la pestaña** → dedup natural) y hace `attach`. Clave: el `await` del PATCH es obligatorio porque el
runtime lee el hilo de SQLite en `ensureLoaded()` durante el `attach`; la fila debe existir antes. El
snapshot repinta el hilo y `resume` (= `claudeSessionId`) continúa la conversación.

**Archivos (solo cliente):** `chatStore.ts` (`fetchEngineHistory`, `openEngineSession`, `fetchHistory`
ahora expone `claudeSessionId`), `useChatSession.ts`, `ChatView.tsx` (pasa `workspace` como cwd),
`ChatHistory.tsx` + `.module.css`. Typecheck + build verdes.

**Alternativas descartadas:** endpoint de "import" server-side que materialice el transcript sin round-trip
del hilo (más limpio en datos, pero toca el backend ya verificado; para 1 usuario abriendo 1 conversación
a demanda el triple salto server→client→server→client es irrelevante); fusionar ambas fuentes en una sola
lista (confuso: la misma conversación con dos identidades). **Límite conocido:** si el `.jsonl` crece por
fuera tras haber abierto la sesión en esta ejecución del server, el runtime ya cargado no relee (edge
aceptable v1).

---

### 2026-07-31 · Backend en el HOST (systemd), no en Docker — resuelve el "usar mi VPS desde la app"

**Contexto (conversación con el usuario).** Pidió pasar PortaIDE a SSH (poner IP+usuario+contraseña en
Settings). Al desmenuzarlo caímos en que **PortaIDE vive en el mismo VPS al que se conectaría** → SSH
sería contra sí mismo (justo lo que ya descartó el ADR 2026-07-26). El problema real no era el
transporte, era que el backend corre **dentro de un contenedor** sin `docker`, sin la shell del host y
con FS limitado a lo montado. Por eso no podía ni auto-desplegarse.

**Decisión (elegida por el usuario, alcance = herramienta personal / un solo usuario):** mover el
**backend al host como servicio systemd**; el **frontend sigue en Docker** tras NPM. Descartada la
opción de solo montar el socket de Docker (la B): seguía dejando la Terminal encerrada en el contenedor,
no resolvía "usar el VPS entero".

**Por qué SSH NO:** con PortaIDE en el mismo VPS, SSH no aporta nada y añade complejidad + un sitio donde
guardar credenciales. SSH solo ganaría para **multi-VPS** (conectar a OTRAS máquinas), que sigue siendo
futuro. Si algún día se hace, con **clave dedicada** (nunca contraseña guardada), ver ADR 2026-07-26.

**Implementado (repo, typecheck verde):**
- `docker-compose.yml` → solo `frontend` + `extra_hosts: host.docker.internal:host-gateway` (backend
  fuera; volumen `portaide_data` y red `internal` eliminados).
- `client/nginx.conf` → `/api` y `/ws` hacen proxy a `http://host.docker.internal:4100` (estático, vía
  /etc/hosts; sin el resolver de Docker). **NPM no cambia**: sigue apuntando a `portaide-frontend`.
- `server/src/config/env.ts` + `index.ts` → nuevo `HOST` (default `0.0.0.0`) para que el contenedor del
  frontend alcance el backend por `host-gateway`.
- `deploy/portaide-backend.service` (unit), `scripts/deploy.sh` (deploy host/desde la propia Terminal),
  `deploy/README.md` (guía paso a paso), `.env.example` (HOST + SQLITE_PATH del host).
- **Sin cambios en terminal/chat**: el pty lanza `process.env.SHELL -l` heredando `HOME`/env → en el host
  es la shell real de `kuoyii` (con `clauded`, docker, logs). El chat sigue con el Agent SDK in-process y
  aprobaciones reales. NO se pierde nada del chat actual.

**Coste asumido (CLAUDE.md §11):** el borde pasa de proteger "una cajita" a **el VPS entero**, y corre
`clauded`. Por eso la migración **exige paso 0 = endurecer el borde** (recomendado Tailscale; alt. 2FA/
passkey o mTLS en NPM) y **paso 1 = UFW cerrando el 4100** al exterior. El backend en 0.0.0.0 es un
proceso del host → UFW sí lo gobierna. Documentado en `deploy/README.md`.

**Pendiente = acción del host (no ejecutable desde el contenedor):** Tailscale, `npm ci && build` en el
host, systemd `enable --now`, UFW, rebuild del frontend, bajar el backend Docker viejo. Pasos exactos en
`deploy/README.md`.

---

### 2026-07-26 · Terminal en 2º plano: `TerminalRuntime` (el pty deja de morir con el WebSocket)

**Problema (reportado por el usuario):** "bloqueo el móvil o salgo de la app, vuelvo y se ve que ha parado".

**Diagnóstico (verificado, no deducido).** Se midió en el VPS real cortando el socket a la fuerza
(`terminate()`, como un móvil que bloquea pantalla):

- **Chat: NO se paraba.** El `SessionRuntime` (ADR 2026-07-03) ya funcionaba: 60 s de trabajo (`TICK-1`…
  `TICK-10`) completados sin ningún cliente conectado, y el `snapshot` al reconectar traía todo.
- **Terminal: SÍ moría.** `pty.ts` mataba el proceso en `ws.on('close')`, no había registro de ptys, ni
  scrollback en servidor, ni id de sesión. Peor: `AppShell` monta la vista activa con `key={view}`, así
  que **cambiar de vista ya mataba la terminal** y lo que estuviera ejecutando (`clauded` incluido).
- La salida del pty **se descartaba** si el socket no estaba `OPEN` (no se acumulaba en ningún sitio).

**Decisión.** Replicar en la terminal el patrón que el chat ya tenía: `server/src/terminal/runtime.ts` con
`TerminalRuntime` + `TerminalRuntimeManager` singleton. El pty pertenece al runtime, **no** al socket;
`/ws/terminal` pasa a transporte **multiplexado por `sessionId`** (`attach|input|resize|detach|kill` →
`snapshot|data|exit|error`). Cerrar el socket = `detach`, nunca matar.

- **Ring buffer** de 256 KiB por sesión (`TERMINAL_SCROLLBACK_BYTES`), recorte UTF-8-safe: al reengancharte
  el `snapshot` repinta lo que pasó mientras no estabas.
- **Sesiones muertas retenidas**: si la shell muere sin nadie mirando, el runtime NO se borra; el siguiente
  `attach` recibe `snapshot{alive:false, exitCode, data}` y **no** se suscribe. Motivo: si tu `clauded`
  revienta con el móvil apagado tienes que **enterarte**, no encontrarte una shell nueva como si nada.
- **Cota `TERMINAL_MAX_SESSIONS` = 6** y reaper de huérfanos a las **2 h** (`TERMINAL_ORPHAN_TTL_MS`, generoso
  a propósito: el caso de uso es dejar tareas largas corriendo). La cota cuenta solo sesiones vivas.
- Arreglado de paso: el `cwd` del cliente se ignoraba (la terminal siempre arrancaba en `FS_ROOT`); ahora
  viaja en el `attach` y se resuelve con `resolveCwd` **dentro del manager** (nadie puede saltarse `FS_ROOT`).

**Sin retrocompatibilidad**: el protocolo viejo (`output`, tramas sin `sessionId`) desaparece.

**Correcciones tras la revisión (mismo día, fallos REPRODUCIDOS):**

- **Identidad de runtime, nunca borrado "por id".** El borrado diferido del runtime muerto (30 s) borraba del
  mapa a su **sucesor** cuando se reiniciaba una pestaña (`kill` → `attach` con el mismo id). Efecto: la
  terminal seguía pintando pero dejaba de aceptar entrada **sin aviso**, y el pty quedaba huérfano —invisible
  para el reaper, sin contar para la cota y **sobreviviendo a `shutdown()`**—. Ahora `remove(sessionId, owner)`
  solo borra si la entrada del mapa sigue siendo ese runtime, y un runtime `discarded` **enmudece** (no emite
  tramas ni programa borrados), de modo que un `exit` rezagado del pty viejo no puede aterrizar en la
  pestaña nueva.
- **Cerrar mata de verdad: SIGHUP → SIGKILL.** `kill()` escalaba solo SIGHUP, así que una shell con
  `trap '' HUP` sobrevivía al cierre explícito Y al apagado del servidor. Ahora se escala a SIGKILL (2,5 s en
  cierre normal, 250 ms en `shutdown()`, con guarda anti-reuso de PID y un hook `process.once('exit')` que
  remata a los que no confirmaron su muerte). **Motivo:** cerrar es una acción explícita del usuario o del
  recolector; una shell que ignora la señal educada no es un caso a respetar, es CPU comida en un VPS que ya
  se congela. El `exit` de un cierre explícito pasa a emitirse **en el acto** con `exitCode: null`.

---

### 2026-07-26 · El cliente móvil no detectaba el socket muerto (causa real del "se ha parado" en el Chat)

**Hallazgo.** El backend del chat estaba bien; el fallo era del cliente. En móvil el WebSocket queda **zombi
en `readyState === OPEN`** (pantalla bloqueada, WiFi↔datos): `onclose` no dispara hasta pasados minutos,
`connect()` hacía early-return por verlo "OPEN", y **no existía ni un listener de `visibilitychange` /
`online` / `pageshow`** en todo el cliente. Resultado: el hilo dejaba de crecer = indistinguible de "parado".
Además, si fallaba el `GET /api/chat/sessions` inicial (típico al relanzar la PWA con la red fría), el
cliente **fabricaba una sesión vacía** y no reintentaba nunca: parecía que la conversación se había perdido.

**Decisiones.**

1. **Salud por tramas, no por `readyState`**: `lastFrameAt` + reconexión forzada si el socket lleva ~20 s mudo
   al volver a primer plano. Listeners de ciclo de vida en Chat y Terminal. Backoff exponencial con jitter
   (500 ms → 15 s). Heartbeat **ping/pong del servidor** (`server/src/ws/heartbeat.ts`, 30 s) que hace
   `terminate()` de los sockets que no responden: sin esto el server cree que sigues mirando (subscribers
   fantasma) y nunca podría dispararse el push.
2. **`ack` del servidor para los mensajes de chat** (`{type:'ack', sessionId, localId}` en `chat/ws.ts`). El
   cliente reenvía lo no confirmado al reconectar, con dedupe por `localId`. **Alternativa descartada:** que
   el cliente dedujera del `queueLength` del snapshot si el server ya tenía el mensaje — adivinar mal
   **duplica un turno entero del agente** (con `bypassPermissions`, trabajo real ejecutado dos veces).
3. **Estado visible**: tira de conexión (DESIGN §6.3), **un solo patrón compartido** por Chat y Terminal —
   oculta cuando todo va bien, visible solo en `connecting`/`disconnected` tras 800 ms. En una pantalla de
   móvil no se gastan 30 px permanentes en confirmar lo normal. Burbuja con estado *enviando* / *No
   entregado* + reintentar: nunca se finge un envío.
4. **Ids de item deterministas** (índice del evento en el log) y auto-scroll solo si ya estabas al fondo:
   reconectar ya no te tira del sitio donde estabas leyendo.

**Correcciones tras la revisión (mismo día):**

- **El guard de idempotencia estaba ROTO tal y como se escribió primero.** Comprobaba el log y la cola, pero el
  servidor registra la burbuja del usuario **después** de esperar slot de concurrencia
  (`CHAT_MAX_CONCURRENT_TURNS`, default 3): durante esa espera el mensaje no estaba en ninguno de los dos
  sitios y un reenvío arrancaba un **segundo turno**. Arreglado con un `Set` `accepted` marcado **antes** del
  `await`, purgado al entrar la burbuja al log, al abortarse esperando slot y al vaciarse la cola con `stop()`.
  Reproducido antes y después: con el slot ocupado, dos envíos del mismo `localId` → **una** burbuja.
- **`ack` = recepción, NO entrega al hilo.** Borrar el pendiente al recibir el `ack` hacía que la burbuja
  del usuario **apareciera y se borrara** mientras el turno esperaba slot (y si el server caía en esa ventana,
  el mensaje se perdía sin rastro). Ahora el `ack` solo marca `acked` (deja de reenviarse y de caducar) y la
  burbuja vive hasta que llega su evento `user` del log — mismo id, relevo sin parpadeo ni duplicado.
- **Una pestaña de terminal muerta no revive sola**: `attach` no engancha pestañas con `alive:false` (solo las
  revive `restartTab`, acción explícita). Antes, cualquier reconexión pasados 30 s creaba una shell nueva y
  hacía desaparecer el aviso de "la shell terminó".
- **El watchdog de la terminal no corta por falta de eco**: escribir una contraseña (`sudo`, `ssh`, `read -s`)
  no genera eco y el socket se daba por muerto, perdiendo las teclas. Ahora sondea con un `attach` y solo
  declara zombi si no hay respuesta. Se prioriza **no cortar en falso** sobre detectar rápido.
- **Exclusión mutua real por sesión (2ª revisión).** El guard de encolado era `if (this.turn)`, pero
  `this.turn` no se asigna hasta después de esperar slot: dos mensajes DISTINTOS llegados en esa ventana
  arrancaban **dos turnos en paralelo sobre el mismo `claudeSessionId`** —con `bypassPermissions`, dos
  agentes escribiendo el mismo repo a la vez—. Ahora el guard es `this.turn !== null || accepted.size > 0`.
- **El flag `stopped` ya no es pegajoso (2ª revisión).** `stop()` con la sesión ya parada (p. ej. doble
  toque en ■) lo dejaba armado para siempre, y el **siguiente** mensaje del usuario se descartaba en
  silencio —con `ack` enviado, así que el cliente lo daba por entregado y la burbuja se quedaba en
  "enviando" indefinidamente—. Ahora solo se arma si hay de verdad un turno esperando slot.
- **Un fallo de SQLite ya no tumba el proceso** (`try/catch` en `ensureLoaded` + `.catch` en los `void` de
  `ws.ts`): en Node 20 un rechazo sin manejar mata el servidor, justo lo que no puede pasar en una
  herramienta que debe seguir trabajando con el móvil apagado.

---

### 2026-07-26 · Notificaciones push en iOS: solo con la PWA instalada (IMPLEMENTADO, sin probar en dispositivo)

**Decisión del usuario:** iPhone; avisos de **"terminó el trabajo"** y **"está trabajando"**.

**Restricciones que condicionan el diseño** (no son opinables, son de la plataforma):

- Safari **solo** entrega Web Push si la PWA está **instalada en la pantalla de inicio** (iOS 16.4+). En
  Safari normal no hay push. Settings debe **detectar el modo standalone** y explicarlo, no fallar en silencio.
- **iOS no tiene notificaciones silenciosas**: "está trabajando" sonará/vibrará como cualquier otra. Se
  implementa con `tag` por sesión (la de "terminó" la reemplaza) y **desactivada por defecto**; "terminó" sí
  activa por defecto.
- Requiere **Service Worker**: creado en `client/public/sw.js`, **solo para push** (sin caché ni precaching;
  la app no pasa a offline-first).

**Implementación:** `server/src/push/*` (servicio VAPID, tabla `push_subscriptions`, rutas bajo el gate de
auth, notifier) + panel en `client/src/views/Settings/NotificationsPanel.tsx`. Consume dos hooks del
`SessionRuntime`: el ya existente `onIdleWithoutSubscribers` ("terminó"/"falló") y uno nuevo,
`onBusyWithoutSubscribers` ("sigue trabajando", con debounce de `PUSH_WORKING_DELAY_MS` = 20 s que se cancela
si vuelves antes). Mismo `tag = sessionId`: la de "terminó" **reemplaza** a la de "trabajando". Durante
`shutdown()` no se notifica (si no, cada redeploy mandaría un "ha terminado" falso).

**Depende del heartbeat**: sin él los sockets fantasma harían creer al server que sigues mirando y ninguno de
los dos hooks dispararía. Los toggles viven **en el servidor** (tabla), no en el SW: iOS obliga a mostrar todo
push que llegue, así que filtrar en el cliente no sirve de nada.

---

### 2026-07-26 · SSH con usuario/IP/contraseña en Settings: NO (la premisa era falsa)

**Petición del usuario:** pasar a SSH, con usuario, IP y contraseña en Settings, "para ver los logs del
proyecto, porque si trabajo desde PortaIDE eso se queda en el contenedor Docker".

**La premisa no se sostiene (verificado en el contenedor):**

```
/home/kuoyii/.claude  -> /home/kuoyii/.claude  (rw)
/home/kuoyii/servers  -> /home/kuoyii/servers  (rw)
```

Los transcripts de Claude Code y los archivos de los proyectos **son los mismos ficheros que se ven por SSH**.
Lo único que falta es **acceso a Docker**: en `docker-compose.yml:49` el montaje del socket está **comentado**.

**Opciones, ordenadas por lo que se defendería:**

1. **Backend en el host (systemd), sin Docker.** Si el objetivo es "que sea idéntico a mi SSH", esto *es* eso:
   mismo usuario, shell, alias, Docker y logs. Coste: se pierde el aislamiento y el `compose up`.
2. **Descomentar el socket de Docker** + `docker-cli` en la imagen. Dos líneas. Coste real: quien controla el
   socket **es root en el host**; sube el techo de daño de "mis proyectos" a "el VPS entero".
3. **SSH**: para ver logs es dar la vuelta al mundo (el backend ya corre *en* ese VPS: sería SSH a sí mismo).

**Rechazado en cualquier caso: guardar la contraseña del servidor en la app.** Un compromiso del borde pasaría
de costar "los proyectos" a costar **la contraseña del usuario del VPS**, reutilizable en otros sitios.
Cifrarla en reposo es autoengaño (el backend necesita descifrarla, la clave vive al lado). Si algún día se va a
SSH, será con **clave dedicada** restringible por `from=`/`command=` en `authorized_keys`.

**Dónde SSH sí gana:** conectar a **otros** servidores (multi-VPS, ya listado como futuro en el ADR
"Arquitectura v1"). Eso es una feature distinta de "ver mis logs" y se decidirá como tal.

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
- **~~Revalorar SSH / backend-en-host~~ → RESUELTO 2026-07-31 (opción a).** Elegido: backend en el host
  (systemd), frontend en Docker. Ver ADR "Backend en el HOST (systemd)" arriba. El código del repo ya
  está migrado; falta la ejecución en el host (`deploy/README.md`), con el orden que ya se advertía:
  **endurecer el borde primero** (Tailscale como paso 0, UFW en el 1) y **luego** el host.
