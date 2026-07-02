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

### 2026-07-02 · Stack MERN confirmado: MongoDB entra en v1 (decisión del usuario)

- **Decisión:** el stack es **MERN** — **MongoDB + Express + React + Node** — como el resto de
  proyectos del servidor (SmartPeak, total-grind, connectu, fichame). Mongo (imagen `mongo:7`, con
  auth, en red interna Docker) guarda **sesiones/histórico de chat y ajustes**; el estado real de los
  proyectos sigue siendo el **filesystem** del VPS.
- **Motivo:** instrucción directa del usuario; consistencia de infraestructura entre sus proyectos.
- **Nota crítica (registrada):** para una herramienta de un solo usuario, un store JSON habría
  bastado en v1; se acepta Mongo por consistencia operativa (mismo patrón de compose, backups y
  mantenimiento que el resto del servidor) y porque el histórico de sesiones de chat sí encaja bien
  en documentos.

---

### 2026-07-02 · Despliegue: Docker Compose + Nginx Proxy Manager (patrón SmartPeak)

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
- **Backend:** **Express + TypeScript**, **ws** (WebSocket), **node-pty** (pty real), **mongoose** (Mongo).
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

## Pendientes de decidir (no inventar; preguntar o resolver en implementación)

- **Auth de un solo usuario**: mecanismo exacto (passphrase + token de sesión, cookie httpOnly, …) — §11.
- **Detalles del puente `claude`** (ver entrada de arriba).
- **Multi-VPS por SSH**: si algún día se retoma, definir aquí el modelo.
