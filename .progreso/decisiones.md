# Decisiones — ¿por qué se hizo así?

> ADR ligero. Una entrada por decisión relevante. Formato: fecha · decisión · motivo · alternativas descartadas.

---

### 2026-10-29 · Editor: visor de PDF (pdf.js) + vista previa de HTML (iframe sandbox + token)

**Pedido:** "necesito poder previsualizar archivos como html y pdf".

**PDF → pdf.js en canvas, no `<iframe>`/`<embed>`.** El WebView de iOS (la PWA) pinta un PDF embebido como
imagen de la **1ª página** y sin scroll; abrirlo "suelto" en standalone atasca la app (mismo problema que las
descargas, ADR 2026-10-27). pdf.js lo pinta igual en todas partes. **Dep nueva `pdfjs-dist@^6.4.299`**:
- **Build legacy**, no el moderno: el moderno de la v6 usa `Map#getOrInsertComputed` y `Promise.try` sin
  polyfill (APIs de 2025-26 que el WebView de iOS puede no tener); el legacy las trae vía core-js.
- **Carga perezosa** (`import()` al abrir el primer PDF): ~500 KB de librería + 1,2 MB de worker fuera del
  bundle principal. Worker por **`?worker`** de Vite → se emite como `.js` clásico: el nginx del frontend no
  mapea `.mjs` (saldría `octet-stream` y un worker de módulo no arrancaría).
- Virtualización por memoria: iOS limita el total de canvas → solo se pintan las páginas a ±1,5 pantallas y
  se libera el bitmap (0×0) de las lejanas; DPR tope 2 y tope de 8 Mpx por lienzo. Zoom por botones (la PWA
  bloquea el pinch con `user-scalable=no`). El `engines` de pdfjs-dist pide Node ≥22, pero solo afecta a su
  uso en Node: aquí se empaqueta para el navegador (npm solo avisa).
- Descartado: abrir el PDF en una pestaña nueva (en standalone no comparte de forma fiable la cookie y saca
  de la app) y `<object>` (mismo límite de 1ª página en iOS).

**HTML → `<iframe sandbox>` SIN `allow-same-origin` + token de capacidad.** Servir el HTML desde el mismo
origen sería XSS contra la propia app: su JS podría usar la sesión para la FS API o abrir `/ws/terminal`
(= shell del VPS). Con sandbox el documento corre en un **origen opaco**. Consecuencia: sus peticiones
(CSS/JS/imágenes relativos) son *cross-site* y la cookie `SameSite=Lax` no viaja → no pueden pasar el gate.
Solución: `POST /api/fs/preview {path}` (con sesión) crea un **token aleatorio** (24 bytes) que autoriza
`GET /api/preview/<token>/<ruta>` (montado **antes** del gate). Acotado: solo la **carpeta del .html** y
subcarpetas, **ningún segmento que empiece por `.`** (.env, .git, traversal), **lista cerrada de
extensiones web** (lo demás → 404), TTL de 20 min **renovado con el uso**, máx. 32 tokens vivos. Respuestas
con `CSP: sandbox …` (aislada aunque se abra suelta), `Access-Control-Allow-Origin: *` (sin él no cargan
`<script type=module>`, fuentes ni `fetch` desde un origen opaco; no expone nada que el token no dé ya),
`Referrer-Policy: no-referrer`, `nosniff`, `no-store`; `sendFile` con `root` (Range para vídeo/audio en iOS).
- **Riesgo residual aceptado** (en `bugs.md`): un HTML hostil puede leer y filtrar su propio token.
- Descartado: `srcdoc` (no resuelve assets relativos), servir con la cookie (no viaja desde origen opaco),
  subdominio aparte para previews (requiere DNS/NPM: desproporcionado para v1).

**Endurecimiento asociado (`server/src/auth/site.ts`).** El iframe mete JS arbitrario *dentro* de la app;
por si algún navegador adjuntara la cookie a sus peticiones, `requireAuth` (403 `cross_site`) y el upgrade
de **todos los WS** (401) rechazan `Origin: null` y `Sec-Fetch-Site: cross-site|same-site`. Nada legítimo
llega así (PWA y API comparten origen); `same-site` cubre otras apps del VPS en subdominios hermanos. Sin
cabeceras Fetch Metadata (navegadores viejos) sigue cubriendo `SameSite=Lax`. Además `/raw` lleva
`CSP: sandbox` (un `.svg` con `<script>` abierto suelto ya no corre en el origen de la app). Se evita a
propósito comparar `Origin` con `Host` (dependería de cómo reenvía NPM la cabecera Host).

**Verificación:** E2E en Chromium real contra un backend de prueba aislado: 45/45 (render, zoom, errores,
assets relativos, y desde el iframe: cookie/top/API/WS/.env bloqueados).

---

### 2026-10-29 · Pegar en la Terminal desde el móvil: tecla `paste` con `clipboard.readText()`

**Bug:** en el móvil no se podía pegar en la terminal (en PC sí). xterm captura la entrada en un textarea
oculto de 1px; mantener pulsado cae en el canvas y iOS no ofrece "Pegar".

**Decisión:** tecla `paste` en la KeyBar (tras `alt`, visible sin desplazar). Llama a
`navigator.clipboard.readText()` **dentro del click** (iOS exige el gesto y muestra su burbuja "Pegar") y
entrega el texto con `term.paste()` — no con `sendInput` a pelo — para que xterm normalice `\n`→`\r` y lo
envuelva en **bracketed paste** si la app lo activó (zsh, `claude`): un bloque multilínea no se ejecuta línea
a línea. El pegado desarma ctrl/alt. Si la promesa se rechaza (el usuario descartó la burbuja) → no-op. Sin
la API (contexto no seguro) la tecla no se pinta.

**Descartado:** (a) agrandar el textarea de xterm para que el long-press lo alcance — rompe el scroll táctil
y la selección; (b) hoja con un `<textarea>` donde pegar y "Enviar" — más UI y un paso más para el caso
normal; queda como fallback si `readText` resultara poco fiable en algún navegador.

---

### 2026-10-29 · El explorer recuerda carpetas abiertas y scroll al cambiar de vista (caché de módulo)

**Bug:** al ir de Files a otra vista y volver, las carpetas abiertas aparecían cerradas. AppShell desmonta la
vista inactiva (`key={view}`, §5) y la expansión vivía en `useState` de cada `TreeNode`.

**Decisión:** `client/src/views/Files/treeCache.ts` — estado a **nivel de módulo** (memoria de la sesión):
`expandedDirs` (Set de rutas absolutas), `listings` (último listado por carpeta) y `scroll` (ligado al
workspace). Al remontar, el árbol se pinta **al instante desde la caché** y cada carpeta expandida (y la raíz)
**se revalida en silencio** (stale-while-revalidate) → recoge lo que haya creado/borrado el agente sin el
parpadeo de "cargando…". Como el árbol entra en el mismo commit, un `useLayoutEffect` en `FilesView`
restaura el `scrollTop`. Re-expandir una carpeta ahora siempre refresca su listado (antes se cacheaba en el
componente para siempre).

**Descartado:** (a) **mantener las vistas montadas** (`display:none`) — cambia el contrato de AppShell para
las 5 vistas y es justo lo que se evitó con el Chat (DESIGN §6.7: remontar árboles enormes mataba iOS);
(b) **solo recordar `expandedDirs`** — vuelve el parpadeo por carpeta y el scroll no se puede restaurar
porque la altura llega tarde; (c) **persistir en `localStorage`** — sobreviviría a que iOS mate la PWA, pero
no se pidió; queda como mejora opcional (rutas borradas serían inocuas: su fila ya no se pinta).

---

### 2026-10-27 · Descargar archivos/carpetas sin navegar la página (fix PWA standalone iOS)

**Síntomas reportados** (dos caras del mismo bug): (1) "descargar carpetas no hace nada, le doy al botón y
no pasa nada, no sé si carga"; (2) "al descargar un archivo me sale la pantalla blanca de descarga de iOS,
le doy, se descarga, pero para volver tengo que salir de la app y reabrir".

**Causa.** La descarga (18ª sesión) era un `<a href={fsDownloadUrl} download>` que hace una **navegación de
nivel de página**. El `manifest` declara `"display": "standalone"` → en iOS la PWA corre en un WKWebView
**sin gestor de descargas ni botón atrás**:
- **Archivo**: el webview navega a la vista de descarga de iOS; la PWA se queda ahí sin forma de volver →
  hay que matar la app. 
- **Carpeta (`.zip`)**: el webview no sabe previsualizar un zip y no tiene a dónde descargarlo → el toque
  se traga en silencio (el botón "no hace nada").

**Decisión: no navegar NUNCA la página para descargar.** Componente `DownloadLink` + helper
`api/download.ts`:
- **Fuera de la PWA** (escritorio, Android en pestaña, Safari normal): se deja el `<a download>` nativo
  intacto — funciona y hace **streaming** (cero memoria). Se detecta con `display-mode: standalone` /
  `navigator.standalone`.
- **En standalone (iOS)**: se intercepta el click (`preventDefault`), se trae el recurso con `fetch`
  (`credentials:'include'` → la cookie de sesión viaja, el gate de auth sigue valiendo) a un blob y se
  entrega con la **Web Share API** (`navigator.share({files})` → hoja "Guardar en Archivos"), con fallback
  a object URL + `<a download>` sintético. Nada toca `document.location` → la app no se atasca. Spinner
  mientras trabaja (ataca el "no sé si carga").

**Alternativas descartadas.**
- `target="_blank"` / `window.open` para "salir a Safari": en iOS el almacenamiento de la PWA instalada
  está **particionado** respecto a Safari → la cookie de sesión podría no estar y daría **401**. Además no
  garantiza romper el standalone para URLs dentro de scope. La Web Share mantiene todo en el fetch con
  cookie de la propia PWA.
- Mantener el `<a download>` y solo arreglar el zip: no cubre el atasco del archivo.

**Compromiso conocido (en `bugs.md`).** La Web Share exige el blob **en memoria**; un zip de carpeta enorme
consume RAM. Y `navigator.share` requiere *transient activation*: si el `fetch` tarda > ~5 s (zip gigante
por enlace lento) iOS puede rechazarlo con `NotAllowedError` → cae al fallback por object URL, que en
standalone es menos fiable. Aceptable para herramienta de un solo usuario con carpetas de proyecto normales.

---

### 2026-08-05 · El hilo del Chat se pinta con techo (la PWA se reiniciaba al volver a la vista)

**Síntoma reportado:** "estoy en Chat, cambio de pestaña, vuelvo y la app peta / se reinicia" (PWA en
iPhone). Lo que se ve es el **splash**: no es un error de JS, es la **página recargándose entera**.

**Causa (medida, no supuesta).** Dos hechos que se multiplican:

1. `AppShell` monta la vista activa con **`key={view}`** (para reproducir la animación de entrada), así
   que navegar **desmonta y remonta** la vista: volver al Chat reconstruye el hilo COMPLETO en un solo
   commit síncrono de React, con todo el Markdown re-parseado desde cero (`memo` no salva un *mount*).
2. **Nada del render tenía techo.** Medido contra `data/portaide.db` (16 conversaciones, 4,6 MB de log),
   la mayor: **3.673 eventos → 632 tool-cards, 10.883 líneas de diff** (una sola card: **485**), **3.558
   líneas de salida de bash**, 30 KB de Markdown ⇒ **~45.000 nodos DOM**.

45.000 nodos construidos de golpe en un WKWebView de iPhone es el pico que dispara el *jetsam*: el
sistema mata la pestaña y la PWA vuelve a arrancar. Encaja con que el usuario lo asocie a
**conversaciones largas**.

**Decisión: el hilo tiene techo de render SIEMPRE** (DESIGN.md §6.7), en dos niveles:

- **Ventana del hilo**: se pintan los últimos **120 bloques**, con una fila-botón `▲ Mostrar mensajes
  anteriores` que suma **+120** y conserva la posición de lectura.
  **Aprendido a base de fallarlo:** la primera versión contaba la ventana **por mensajes** (últimos N
  items, mínimo 6) y **no servía de nada** — `reduceEvent` no cierra el mensaje del asistente en
  `assistant_done` (`chatStore.ts:593`), solo con `user`/`result`/`error`, así que **un turno entero es
  UN item**: en la base real hay uno de **576 bloques**. Con el mínimo de items mandando sobre el
  presupuesto se pintaban **638 bloques de 844** (~16.400 nodos) justo en la conversación del bug. La
  regla correcta es presupuesto **duro** de bloques, **recortando el primer item visible por su cola**.
  Lo destapó el `revisor` midiendo con el ensamblador REAL del store; el primer número que dimos por
  bueno (2.598 nodos) salía de un script que troceaba los items en `assistant_done` y era **falso**.
- **Techo por card**: diff a **24 líneas**, salida de bash a **16**, con `⋯ N líneas más` que expande esa
  card entera. La expansión es **efímera** a propósito: si se persistiera, volver a la vista reconstruiría
  otra vez el árbol gigante y el bug volvería por la puerta de atrás.
- **La congelación de la ventana tiene tope (3× el presupuesto).** Para no desmontarle contenido a quien
  está leyendo hacia arriba, el borde superior se congela; pero el inferior sigue creciendo con el turno,
  así que sin tope la ventana acababa siendo **la conversación entera** (medido: 1.020 bloques) — el techo
  desaparecía justo mientras el agente trabaja, que es cuando más crece. Lo destapó la **segunda pasada**
  del `revisor`, ya sobre el fix.

**Alternativas descartadas:**

- **Quitar el `key={view})` / mantener las 5 vistas montadas y ocultarlas.** Evita el remount, pero deja
  vivos a la vez xterm, CodeMirror y el hilo completo: cambia un pico de memoria por un suelo de memoria
  permanente más alto, que en un iPhone es peor. Además no arregla la raíz (un hilo sin límite no se
  puede pintar sin límite) y el primer render seguiría costando lo mismo.
- **Virtualización real** (`react-virtual`/`react-window`): dependencia nueva y mal encaje con items de
  altura muy variable (una card de bash mide lo que mida) y con el auto-scroll de streaming. La ventana
  por presupuesto de bloques da el 90% del beneficio con ~40 líneas y cero dependencias.
- **Truncar en el servidor / podar el log**: perdería historia real y rompería `resume`. El log completo
  es correcto; lo que no puede ser completo es el **DOM**.

**Lo que NO se toca (y por qué se anota):** el `key={view}` sigue ahí; el borrador del composer y el
scroll se siguen perdiendo al cambiar de vista, y Terminal/Editor siguen remontando. Es coste conocido,
menor comparado con esto, y va a `bugs.md`.

---

### 2026-08-04 · Source Control: git desde la UI, dentro de Files, sin librería y sin nada destructivo

**Petición:** "integrar GitHub para hacer commit, push, pull… sin usar la terminal".

**Decisión (4 partes):**

1. **Es git, no la API de GitHub.** Commit/push/pull son operaciones del repo **local** del VPS. La API
   de GitHub (PRs, issues, Actions) no interviene y queda para v2. Meterla ahora habría añadido un token
   con más permisos y una segunda fuente de verdad para lo mismo.
2. **No es una sexta vista.** Vive **dentro de Files** (chip de rama en la cabecera → hoja inferior), como
   el Source Control de VS Code. Las 5 vistas de CLAUDE.md §3 son el norte de producto; un sexto destino
   habría diluido la navegación por una función que se usa en ráfagas cortas.
3. **Sin librería de git** (`simple-git`, `isomorphic-git`): se invoca el binario con `execFile` (sin
   shell) y se parsea `--porcelain=v2 -z`, que es una interfaz estable pensada para máquinas. Cero
   dependencias nuevas, control total del entorno del subproceso (clave para la credencial) y el mismo
   `git` que ya usan la Terminal y Claude. `isomorphic-git` habría reimplementado el cliente en JS con su
   propio comportamiento; `simple-git` es un wrapper de lo mismo que hacemos en ~40 líneas.
4. **Alcance sin operaciones destructivas** (regla dura): estado, preparar/quitar, commit, push,
   `pull --ff-only`, fetch y ramas. **Fuera:** force-push, `reset --hard`, descartar cambios, stash,
   merge/rebase con conflictos. Si git dice que hace falta fusionar, el panel lo explica y remite a la
   Terminal. Un móvil no es sitio para resolver un merge a tres bandas, y un botón que borra trabajo sin
   vuelta atrás en una pantalla táctil es una trampa.

**Credencial (CLAUDE.md §11).** `GITHUB_TOKEN` en el `.env` del host (que systemd ya inyecta con
`EnvironmentFile`). Viaja al subproceso `git` **por variable de entorno** y lo lee un *credential helper*
efímero (`-c credential.helper='!f() { … }; f'`). Descartadas: el token en la URL del remoto (queda escrito
en `.git/config` y en logs) y `http.extraheader` (aparecería en `ps aux`). Antes se resetea la lista de
helpers heredados (`-c credential.helper=`) y se fuerza `GIT_TERMINAL_PROMPT=0` para que **nunca** se quede
un `git` colgado esperando una contraseña. El token **no sale nunca al cliente**: el status solo publica un
booleano `tokenPresent`. Alternativa descartada: deploy key SSH — igual de válida, pero exige generar y
pegar la clave en cada repo; el PAT se revoca en un clic y ya estaba a mano.

**Otros detalles con motivo:**
- **Serialización por repo** (mutex por raíz): dos operaciones a la vez chocan por el `index.lock`.
- **El `cwd` no manda**: toda mutación se ejecuta sobre la raíz que devuelve `rev-parse --show-toplevel`,
  y se rechaza si cae fuera de `FS_ROOT`. Las rutas del cliente se validan contra la raíz del repo y
  siempre van tras `--` (nada de nombres de archivo que se cuelen como flags).
- **`fetch` al abrir el panel**, no en cada status: `↑n ↓n` solo son reales tras hablar con el remoto,
  pero pagar esa latencia en cada refresco del explorer no compensa.
- **Errores traducidos** (`diverged`, `rejected`, `dirty_worktree`, `auth_required`…): la salida cruda de
  git en inglés no le dice nada a nadie desde el móvil, pero se conserva como `detail` cuando no hay
  traducción, en vez de tragarse el fallo.

---

### 2026-08-04 · Chat: cada conversación se ANCLA a un proyecto (`cwd` por sesión, congelado al primer mensaje)

**Síntoma (usuario):** "cuando abres un chat te tiene que indicar a qué proyecto hace referencia; hoy no
lo hace" + "quiero poder cambiar la carpeta desde ahí, pero solo para conversaciones no iniciadas".

**Causa:** el chip `@…` del composer pintaba el **workspace global** (`useWorkspace()`), y el `cwd` viajaba
**por mensaje** con ese mismo valor: cambiar de carpeta en Files movía de proyecto a TODOS los chats
abiertos, incluidos los que ya tenían hilo. La columna `cwd` existía en SQLite desde el principio pero
**nunca se escribía** (`upsertSession` la fijaba a `null` y el PATCH ni la aceptaba).

**Decisión:** el `cwd` pasa a ser **propiedad de la conversación** (ancla de proyecto), no del workspace:

- **Servidor autoritativo.** `SessionRuntime` guarda la carpeta con la que arrancó el **primer turno**;
  a partir de ahí **ignora el `cwd` que llegue en los mensajes** y la publica en el `snapshot`. Se
  persiste con el resto del log (`upsertSession({cwd})`, que solo la escribe si la fijó ese turno: nunca
  machaca la de la fila). `PATCH /api/chat/sessions/:id` acepta `cwd`, validado con el nuevo
  **`resolveDirSafe`** (bajo `FS_ROOT` + tiene que ser un directorio existente → si no, 400 `bad_cwd`;
  antes una ruta basura caía en silencio a la raíz).
- **Cliente.** `ChatSession.cwd` (null = sin anclar). Un chat nuevo **hereda el workspace activo**
  (`defaultCwd`, que la vista sincroniza) y lo fija al enviar el primer mensaje. El chip del composer
  muestra ese proyecto y, **solo con el hilo vacío**, es un botón que abre el `FolderPicker`
  (`isChatStarted()` — hilo, turno vivo o `claudeSessionId` — es la definición única, compartida por
  store y UI). El historial del engine del panel pasa a listarse por el proyecto del **chat activo**.
- **`FolderPicker` extraído** de `views/Files/` a `components/FolderPicker/` (patrón repetido → componente,
  CLAUDE.md §9), con `title`/`confirmLabel` parametrizables. Estilos movidos a su propio módulo CSS.

**Por qué congelarlo (y no dejar cambiarlo siempre):** el engine indexa sus transcripts **por proyecto**
(`~/.claude/projects/<cwd-sanitizado>`); mover el `cwd` a mitad de hilo dejaría el historial partido en
dos carpetas y el `resume` apuntando a un proyecto que ya no es el suyo. La regla que pidió el usuario
("solo conversaciones no iniciadas") no es solo orden: es lo correcto técnicamente.

**Alternativas descartadas:** (a) seguir mandando el workspace en cada mensaje y solo *mostrarlo* mejor —
no arregla el problema real (chats viejos cambiando de proyecto a tus espaldas); (b) permitir cambiarlo
siempre y arrancar un `claudeSessionId` nuevo al mover la carpeta — rompe la continuidad del hilo sin que
el usuario lo pida; (c) confiar solo en la UI para el bloqueo — un cliente viejo (o una pestaña abierta
antes del deploy) seguiría mandando su `cwd`: por eso el ancla vive en el servidor.

**Verificado (pruebas reales, no supuestos):** typecheck + build verdes; contra SQLite real — alta con
ancla, `persistNow` sin `cwd` **no la borra**, cambio de ancla en chat sin estrenar, y aparece en la lista;
`resolveDirSafe` rechaza fichero, `/etc`, traversal e inexistente; y con el `SessionRuntime` real (puente
sustituido por un stub) — el 1er turno fija el ancla, **el 2º mensaje con otra carpeta la ignora**, se
persiste y el `snapshot` la publica. **Sin commit ni deploy.** Falta QA en dispositivo.

---

### 2026-08-01 · Teclado del móvil: barra de teclas del Terminal tapada — `--kb-inset` vía `visualViewport` (scoped a Terminal)

**Síntoma (usuario):** "en Terminal, al escribir no veo el teclado de la app (esc, ctrl…)". La `KeyBar`
quedaba **detrás del teclado del sistema**.

**Causa:** el marco (`AppShell .shell`) está anclado con `position: fixed; inset: 0` a la **layout
viewport**, que **no se encoge** al abrir el teclado del móvil (decisión deliberada del shell: evitar
reflow para que la nav quede pegada abajo, sin hueco residual). El teclado se dibuja **encima** del borde
inferior → la `KeyBar` (último hijo flex de la columna) queda tapada. No había ninguna lógica de teclado.

**Decisión:** hook `useKeyboardInset` (`client/src/hooks/`) que publica en `<html>` la var `--kb-inset` =
solape del teclado, medido con `window.visualViewport` (`innerHeight - vv.height - vv.offsetTop`,
coalescido en rAF, umbral 80px para ignorar barra de URL/redondeo; si no hay `visualViewport`, no-op). La
**vista Terminal** lo consume: `.view` reserva `padding-bottom: var(--kb-inset)` (sube la columna por
encima del teclado; `.panes` se reajusta solo por el `ResizeObserver`+`FitAddon` ya existentes) y la
`.keybar` descuenta ese solape de su holgura nav/safe-area (`max(0, nav+safe - kb)`) para quedar pegada
justo encima del teclado.

**Por qué scoped al Terminal y NO a la shell global:** respetar la decisión del AppShell (fixed, no
reflow, nav pegada). El mismo patrón se puede **subir a global/Chat** si el composer del Chat resulta
tener el mismo problema (síntoma latente): entonces `--kb-inset` ya está disponible para reusar.

**Alternativas descartadas:** (a) `interactive-widget=resizes-content` en el `<meta viewport>` — Safari
iOS **no lo soporta** (PortaIDE se usa en iPhone), y cambia el reflow global. (b) Flotar solo la `KeyBar`
con `translateY` sin encoger `.panes` — el prompt (fondo del terminal) seguiría tapado por el teclado.

**Verificado:** typecheck + build (server tsc + client vite) verdes. **Sin commit ni deploy.** Falta QA
en dispositivo (abrir Terminal → teclear → la barra `esc/ctrl/…` debe quedar visible sobre el teclado).

---

### 2026-08-01 · Terminal: auto-repeat del backspace en iOS — repetición sintética (no nativa)

**Síntoma (usuario):** en Terminal, mantener pulsado el borrado del teclado del iPhone **no repite**;
hay que tocar de uno en uno.

**Causa:** iOS **no emite `keydown` repetidos** al mantener pulsada una tecla del teclado virtual (sí lo
hace el escritorio, y por eso las flechas de la KeyBar sí repiten con su propio timer). El primer toque de
Backspace sí genera un `keydown` que xterm traduce a un DEL (por eso el toque suelto borra), pero la
pulsación mantenida se queda muda: el auto-repeat nativo de iOS solo actúa sobre contenido editable real y
el `textarea` oculto de xterm está vacío.

**Decisión:** repetición **sintética** en `TerminalPane` (`attachBackspaceRepeat` sobre `term.textarea`).
Al primer `keydown` de Backspace —xterm ya ha borrado ese carácter— se programa, tras un retardo inicial
(400ms, como el SO), el reenvío de `DEL` (`SEQ.del = \x7f`) cada 55ms hasta el `keyup`, con tope de 500
repeticiones por si el `keyup` se pierde. Guardas para no romper otras plataformas: **solo puntero grueso**
(`pointer: coarse` → móvil) y **solo si `event.repeat` es falso** (si el navegador ya repite —escritorio o
teclado físico en un iPad— nos apartamos para no borrar al doble). Listeners en **fase de captura** para no
depender del orden con los handlers de xterm ni de que este pare la propagación.

**Alternativas descartadas:** (a) rellenar el textarea de xterm con contenido "de relleno" para que iOS
tenga qué borrar y emita `deleteContentBackward` repetidos — invasivo: xterm reenvía el valor del textarea
como input, rompería el pipeline. (b) `beforeinput`/`input` con textarea propia superpuesta — reescribir la
entrada del terminal, demasiado para un fix puntual. (c) No tocar nada / documentar como limitación —
inaceptable para el uso principal (programar desde el móvil).

**Riesgo / supuesto a validar en device:** el fix se apoya en que iOS **sí** emite el `keydown` y el
`keyup` iniciales de Backspace (el `keydown` es casi seguro: el toque suelto ya borra; el `keyup` corta la
repetición — si faltara, el tope de 500 la para igual). **Falta QA en iPhone real** (no verificable desde
el VPS). Si el `keyup` resultara poco fiable, bajar el tope y/o cortar también con un temporizador máximo.

### 2026-08-01 · Confirmado el modelo de acceso: PÚBLICO + TLS(NPM) + auth (NO Tailscale) — análisis del borde (§11)

**Contexto (usuario):** "¿necesito la VPN de Tailscale en el iPhone para usar PortaIDE?" Empíricamente
**no**: entra desde el iPhone (PWA) por **datos móviles** y desde un **iPad sin Tailscale**, con la URL
pública `portaide.<dominio>` + login. Análisis hecho en **modo lectura, sin tocar código** (a petición).

**Hallazgo — el borde real es público; Tailscale NO está cableado como borde.** Ruta verificada en el repo:
Internet → **NPM** (termina TLS) → red `reverse_proxy_network` → `portaide-frontend` (nginx, `expose 80`) →
proxy de `/api` y `/ws` a `host.docker.internal:4100` → **backend en el host (systemd)**. Por eso funciona
sin VPN: es genuinamente público. Tailscale sería un modelo de acceso **alternativo** (privado) que nunca se
puso como borde; el "paso 0 = endurecer con Tailscale" del ADR 2026-07-31 sigue **pendiente en el host**.

**La auth (código) está BIEN implementada — no es el punto débil:**
- Cookie de sesión **httpOnly + Secure(prod) + SameSite=Lax**, JWT HS256, 30 d (`auth/session.ts`, `routes.ts`).
- `SESSION_SECRET` **obligatorio en producción** (el arranque lanza si falta, `config/env.ts`).
- Contraseña con **bcryptjs (10 rounds)** hasheada en memoria; email en **tiempo constante** y `bcrypt.compare`
  se ejecuta **siempre** (sin fuga por timing de si el email existe) (`auth/credentials.ts`).
- **Rate-limit** en `POST /api/auth/login`: 10 intentos / 15 min por IP (`express-rate-limit`).
- **Gate `requireAuth`** cubre todo `/api` salvo `/health` y `/auth/login|logout` (`app.ts`).
- **El upgrade de WS valida la cookie ANTES de abrir el socket** para `/ws`, `/ws/terminal` y `/ws/chat`
  (→ 401 sin sesión; `index.ts` + `auth/ws.ts`). Cubre el punto duro del §11: nada de pty/chat sin sesión.

**Riesgos reales — de POSTURA/configuración, no de código — por severidad:**
1. **Un solo factor guarda un shell completo del VPS + FS + chat con `bypassPermissions`/`clauded`.** Sin
   2FA, la contraseña **es** todo el borde; filtrada/adivinada = compromiso total del VPS. Amplificado por el
   default `bypassPermissions` (ADR 2026-07-03).
2. **Contraseña débil pendiente de cambiar** (la sembrada, además "viajó en claro por chat" — ya en estado.md,
   acción #4). Combinada con (1), es el eslabón débil concreto **hoy**.
3. **No verificable desde el repo (acción del host):**
   - **UFW cerrando el 4100**: el backend escucha en `0.0.0.0:4100` (el propio `env.ts` lo advierte). Si UFW
     no lo bloquea, `http://<ip-vps>:4100` es alcanzable directo desde internet, saltándose NPM y en **HTTP
     plano**. La auth sigue aplicando, pero es exposición innecesaria. Paso 1 del ADR 2026-07-31, **pendiente**.
   - **NPM forzando HTTPS** (redirect http→https + "Force SSL" + cert válido): el nginx del frontend escucha
     HTTP plano; el TLS depende 100% de NPM. La cookie es `Secure` (no viaja por http), pero conviene confirmar.
4. **Menores:** rate-limit **por-IP** (rotación de IP lo evade; sin lockout global ni captcha); sin cabeceras
   de seguridad en el nginx del frontend (HSTS/CSP/X-Frame — NPM podría añadir alguna); JWT **no revocable**
   salvo rotar `SESSION_SECRET` (aceptable, 1 usuario).

**Recomendación (equilibrio elegido por el usuario: comodidad sin VPN):** quedarse en público pero **subir el
borde** — (a) contraseña fuerte YA, (b) 2FA/passkey o Cloudflare Access delante del login, (c) verificar en el
host **UFW(4100)** + **Force-SSL** en NPM. **Alternativa más segura, descartada por fricción:** Tailscale-only
(quitar la exposición pública), que exige la VPN siempre puesta — justo lo que el usuario no quiere.
**Sin cambios de código en esta sesión: solo análisis + este ADR.**

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

### 2026-08-04 · Chat: entrega EN CALIENTE de mensajes (streaming input del SDK)

Corrección de rumbo sobre el ADR de abajo. La cola resolvía "escribir sin bloquearse", pero el mensaje
**esperaba a que terminase el turno anterior**, y lo pedido era lo de Claude Code: que entre mientras el
agente trabaja. Se rehízo el puente sobre el **streaming input** del SDK.

**Lo medido (5 sondas contra el engine, no supuesto):**

- `query({prompt})` acepta `AsyncIterable<SDKUserMessage>` además de un string. Con el iterable, la query
  **sobrevive a cada `result`** y sigue viva esperando más mensajes: se pueden encadenar turnos en la
  MISMA sesión **sin `resume` y sin relanzar el proceso `claude`** (medido: el 2º mensaje arrancó en 2.7 s
  en vez de los ~5 s de un turno nuevo).
- **`priority: 'now'` es obligatorio** para los mensajes inyectados. Sin ese campo (o con `'next'`) el CLI
  **consume el mensaje del canal y lo descarta**: el agente terminó su tarea sin enterarse, y no hubo un
  segundo `result`. Comprobado en las tres variantes. Es el fallo que habría convertido esto en pérdida
  silenciosa de mensajes.
- Con `now`, el mensaje **aborta la herramienta en vuelo** (medido: un `Bash sleep 50` se cortó a los
  ~100 ms del push) y el agente atiende lo nuevo. Es el precio de que te haga caso ya, y es lo que hace
  Claude Code; queda documentado en DESIGN §6.4. **El texto llega de verdad**: se mandó a mitad de una
  tarea un código inventado (`XK-7742`) y lo escribió al terminar — que el agente retome o no lo anterior
  es decisión suya, pero el mensaje no se pierde.
- `resume` (2º turno de una conversación) y `stop` **siguen funcionando** con entrada en streaming.

**Diseño resultante:** `ChatTurn` gana `push(text)` y `endInput()`. El runtime intenta `deliverLive()`
antes de encolar; la burbuja del usuario entra al log **en el momento del push** (por eso se ve
intercalada en el trabajo del agente). La cola solo guarda lo que NO puede entregarse: turno esperando
slot de concurrencia, o mensaje con **otro modelo/esfuerzo/workflows** (esos se fijan al abrir la query;
meter ahí un mensaje que pidió `ultracode` sería servirle otra cosa sin avisar — el permiso sí se cambia
en caliente). Al llegar `result`, `feedNextOrClose()` encadena el siguiente compatible por el mismo canal
o cierra la entrada, para **liberar el slot y el proceso** — mantener sesiones ociosas vivas costaría CPU,
que es el recurso escaso de este VPS.

**Cierre del canal (corregido tras la revisión).** El primer intento contaba `result`s (1 mensaje = 1
turno) y **era falso**: el CLI funde en un solo turno los mensajes que llegan juntos, así que la cuenta no
cuadraba y el turno se quedaba vivo **30 s de más** reteniendo su slot, con el typing indicator puesto y el
push de "terminó" tarde. Criterio bueno: cerrar cuando el CLI ha **recogido del canal** todo lo metido
(`inputChannel.pending() === 0`) — cerrar la entrada no aborta el trabajo en curso, así que es seguro. El
margen baja a **3 s** y solo cubre la ventana push→recogida. Medido: idle a los **0,4 s** del último evento.

**Lo demás que corrigió la revisión:**

- **Una card abierta ya no se marca "✕ Rejected" sin que nadie la rechace.** Inyectar aborta el
  `canUseTool` en vuelo; ahora la resolución lleva `reason: 'user' | 'interrupted'` y la UI pinta
  `⚠ Interrumpido` en `--yellow`. Escenario real y frecuente: hay una pregunta abierta y contestas
  escribiendo en vez de pulsar el botón.
- **Mensaje inyectado que muere con el turno**: `onDropped` lo escribe en el hilo (`⚠ Mensaje no
  entregado…`). Su burbuja ya estaba puesta; callarlo sería fingir que se atendió.
- **El permiso entra en `compatibleWithTurn`**: `setPermissionMode` es un control request asíncrono, así
  que aplicarlo y empujar sin esperar podía ejecutar el mensaje con el modo ANTERIOR — si era bypass,
  ejecutar sin permisos algo que el usuario acababa de poner en Ask (§11). Si el modo difiere, el mensaje
  abre su propio turno.
- `setModel`/`setPermissionMode` actualizan lo que el runtime cree del turno (si no, tras tocar el selector
  la entrega en caliente se desactivaba en silencio); `feedNextOrClose` saca de la cola **antes** de
  difundir (evitaba un frame con la burbuja duplicada); `startTurn` no arranca con el proceso cerrándose
  (dejaba un `claude` huérfano); y el hilo ya no pinta tramos de asistente vacíos.

---

### 2026-08-04 · Chat: cola de mensajes visible + preguntas de Claude (`AskUserQuestion`)

Dos peticiones del usuario: (a) poder escribir sin esperar a que termine el turno, como en Claude Code;
(b) que las preguntas con varias opciones funcionen (hasta ahora solo había Approve/Reject).

**(a) Cola.** El `SessionRuntime` **ya encolaba** desde la 8ª sesión; lo que había era un **bloqueo de
UI** (`canSend = … && !streaming` + guard en `sendMessage`). Se retira ese bloqueo y, además, la cola
**deja de ser un número**: `snapshot`/`status` viajan con `queue: [{localId,text}]`, así que las burbujas
en espera las pinta el **server** (sobreviven a recargar la PWA y se ven desde otro dispositivo).
Verbo nuevo `cancel{sessionId,localId}` → `SessionRuntime.cancelQueued`, que solo retira lo que **aún no
ha arrancado** (si ya corre, manda `stop`). Botón del composer: `↑` siempre que haya texto, `■` solo con
el campo vacío y turno vivo — un botón, una acción.

**(b) Preguntas.** Verificado **empíricamente contra el SDK** (dos sondas + una prueba del puente
compilado), no supuesto:

- `AskUserQuestion` **sí** invoca `canUseTool`, **también en `bypassPermissions`** (el modo por defecto de
  PortaIDE), pese al warning `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`. Preguntar no es pedir permiso: el host
  es quien recoge la respuesta, así que el auto-approve no lo salta.
- Se contesta con `{behavior:'allow', updatedInput:{...input, answers}}`, donde `answers` es
  `{enunciado: respuesta}`; **multiSelect → etiquetas separadas por ", "**, y acepta **texto libre**
  (la vía "ninguna de estas"). Hay que responder **todas** las preguntas: contestar a medias hace que el
  agente vuelva a preguntar (comprobado).
- Por eso el Approve genérico **no funcionaba**: aprobaba sin `answers` y el agente se quedaba igual.

Implementación: evento propio `question_request{requestId, questions}` (input normalizado en el server con
un parser defensivo; si el modelo cambiara la forma, cae al `permission_request` genérico) + verbo
`answer{sessionId,requestId,answers}` → `resolveQuestion`. El `input` que ejecuta la tool lo compone el
**bridge**, no el cliente: la trama solo aporta las respuestas (validadas), así una trama manipulada no
puede reescribir la pregunta.

**Fleco preexistente corregido de paso:** las resoluciones (`permission_resolved`, `question_answered`)
ahora **entran en el log del hilo**. Antes, aprobar y recargar la PWA repintaba la card como pendiente —
pidiendo una decisión que ya no podía resolver nada. Al interrumpir un turno, lo que colgaba se marca
denegado en el log en vez de quedarse eternamente "pendiente".

**Tras la revisión (subagente `revisor`, misma fecha).** Encontró 2 altos reales, corregidos y
re-verificados con sondas:

- **Interrumpir con una pregunta viva no dejaba resolución en el log**: el deny lo hacía el listener de
  `abort`, que **no emitía** nada (y para cuando corría `finish()` el mapa ya estaba vacío). La card volvía
  accionable al reattachar y responder era un **no-op silencioso** mientras la UI decía "✓ respondida".
  Fix: emitir también en el `abort` **y** `SessionRuntime.closeOrphanRequests()` — al resucitar una sesión
  desde SQLite, toda petición sin resolución se cierra (el turno que la esperaba murió con el proceso).
- **`stop()` sin turno vivo no reemitía `status`**: con los slots ocupados, el móvil seguía pintando
  "⏳ En cola" con un Cancelar que ya no cancelaba nada. Fix: `setStatus` al final de `stop()`.
- Además: `cancelQueued` ahora cancela también el mensaje que **espera slot** (podía tardar minutos), deja
  **lápida** para que un reenvío at-least-once no lo resucite (con `bypassPermissions` eso sería trabajo
  real que el usuario canceló), `markQuestion` **reemplaza** una card genérica en vez de dejarla muerta, un
  `status` sin `queue` ya no borra la cola pintada, y `pendingPerm` se limpia al cerrar pestaña.
- **A11y:** las opciones eran `role="radio"` sin roving tabindex ni flechas (patrón ARIA incumplido). Se
  cambió a `role="group"` + `aria-pressed`, que es exactamente la interacción implementada; DESIGN §6.5
  actualizado.

**Alternativas descartadas:** reutilizar `permission_request` y que el cliente compusiera el
`updatedInput` completo (más tráfico y deja que el cliente reescriba el input de una tool que se ejecuta
con `bypassPermissions`); y pintar las preguntas múltiples como **pestañas** (como el CLI): en móvil
esconden preguntas y se pierde el hilo — se apilan en vertical, con contador en la cabecera (DESIGN §6.5).

---

## Nota (2026-08-05) — el warning `CAN_USE_TOOL_SHADOWED` NO aplica a `AskUserQuestion`

El backend escupe en cada turno:

> `[CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] Warning: canUseTool will not be invoked: permissionMode
> 'bypassPermissions' auto-approves every tool call … use a PreToolUse hook instead.`

**Es genérico y engañoso en nuestro caso.** Verificado con sonda real contra `@anthropic-ai/claude-agent-sdk`
**0.3.198**: `AskUserQuestion` **sí** invoca `canUseTool` incluso en `bypassPermissions` (preguntar no es
pedir permiso: el host ES quien recoge la respuesta), y se contesta con `{behavior:'allow', updatedInput:
{...input, answers}}` → el `tool_result` llega como `"Your questions have been answered: …"`.

**Consecuencia:** `bridge.ts` está bien como está. **No** migrar a un hook `PreToolUse` "para arreglar el
warning": rompería el camino que hoy funciona. Si algún día el SDK cambia y `canUseTool` deja de recibir la
tool, la salida sería un hook `PreToolUse` que devuelva `permissionDecision: 'ask'` (según el propio SDK,
la ruta 'ask' emerge como `can_use_tool`), pero hoy no hace falta.

---

## ADR (2026-08-05) — el canal de entrada NO se cierra mientras haya una inyección sin atender

**Contexto.** La entrega en caliente (12ª sesión) empuja el mensaje del usuario en la sesión viva con
`priority:'now'`. Medido contra el CLI: al aceptarlo, **corta el paso en curso y emite un `result`** —el del
turno CORTADO, no el del mensaje nuevo—, y acto seguido abre un turno nuevo (`system/init` con el mismo
`session_id`), a veces tras **>10 s de silencio**.

**Problema.** `SessionRuntime.onEmit` trata cualquier `result` como "el agente terminó": con la cola vacía
llama a `feedNextOrClose()` → `endInput()`. Eso cerraba el canal **en el mismo instante** en que el agente
iba a atender la inyección. Sondas: 2 de 2 mal (mensaje pospuesto al final de la tarea, o **perdido en
silencio** — ni por `onDropped`, porque el CLI ya lo había sacado del canal). Es decir: el síntoma "me
responde cuando termina lo anterior" sobrevivía aunque el código nuevo estuviera corriendo.

**Decisión.** El cierre del canal se **bloquea mientras haya una inyección sin atender** (`injectedLive` en
`bridge.ts`): `closeInput()` aplaza con `INJECTED_GRACE_MS` (20 s, refrescado por cada evento) en vez de
cerrar. El **primer** `result` tras un `push` NO levanta el bloqueo (es el del corte); del **segundo** en
adelante sí, y el cierre recupera el camino rápido —el slot se sigue liberando en ~0,5 s—. El flag se
actualiza **antes** del `send` del `result`, porque el runtime reacciona llamando a `endInput()` de forma
síncrona.

**Por qué no otras opciones.** (a) *No cerrar nunca tras una inyección*: retendría el proceso `claude` y su
slot los 20 s del margen en cada turno, caro en este VPS. (b) *Contar `result`s para decidir el cierre en
el runtime*: ya se descartó en la 12ª sesión (el CLI funde en un turno los mensajes que llegan juntos); aquí
la cuenta vive en el bridge y solo decide **cuándo dejar de bloquear**, con el grace como red de seguridad
si el 2º `result` no llega. (c) *Subir el grace genérico a 20 s*: penalizaría también los turnos normales.

**Matiz que no es un bug.** Con un mensaje del tipo «ignora lo anterior», el modelo a veces **termina** lo
que estaba haciendo antes de responder. Eso es decisión suya: verificado que con una orden clara de parar
acusa **1,6 s** después del envío y corta la tarea en el paso 2 de 12.

### 2026-10-23 · FS: ver imágenes inline + descargar archivos y carpetas (zip)

**Qué.** La FS API solo sabía leer texto (`/read` → 415 en binarios) y no había forma de descargar nada.
Se añaden dos endpoints GET bajo el gate de auth:

- **`GET /api/fs/raw?path=`** — sirve el archivo CRUDO en **streaming** (`createReadStream`), Content-Type
  por extensión (mapa `MIME_BY_EXT`), `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store`. Para `<img src>`. Tope **inline de 25 MB** (`MAX_INLINE_BYTES`) → 413
  `too_large`; por encima el cliente ofrece descargar en vez de previsualizar.
- **`GET /api/fs/download?path=`** — **attachment**. Archivo → se envía tal cual en streaming; **carpeta →
  zip al vuelo** con `archiver` (`archive.directory(abs, basename)` para que cuelgue del nombre de la
  carpeta dentro del zip). **Sin tope**: va en streaming, nunca en memoria. Nombre con `Content-Disposition`
  RFC 5987 (`filename` ASCII + `filename*=UTF-8''…`) para no romper con acentos/espacios.

**Por qué `archiver` (dep nueva, anotada por CLAUDE.md §9).** Node no trae zip. El host **no tiene `zip`**
(solo `tar`), y el backend corre en imagen Docker de Node: una dep JS pura (streaming) evita tener que
instalar un binario de sistema en la imagen. **zip, no tar.gz**, porque iOS/Files lo abre nativo (es una
herramienta móvil). Pin: `archiver@^7` (runtime) + **`@types/archiver@^6`** en dev — OJO: `@types/archiver@8`
(el "latest") reescribió los tipos a *named exports* y **ya no declara la función callable** `archiver(...)`,
así que rompe `import archiver from 'archiver'`; la v6 mantiene `export = archiver`. No subir a 8 mientras
usemos `archiver` 7 con default import.

**Cliente.** `api/client.ts`: `isImagePath()`, `fsRawUrl()`, `fsDownloadUrl()` (URLs same-origin → la cookie
httpOnly de sesión viaja sola; el gate sigue aplicando). **Editor**: las imágenes NO pasan por `readFile`
(las rechazaría); se marcan como "solicitadas" y se pintan con `<ImagePreview>` desde `/raw` (spinner →
imagen → fallback a descarga si el WebView no puede). Binario no-imagen (415 `binary_file`) ya no cae al
estado de error genérico: estado propio `binary` con botón de descarga. **FileTree**: cada fila lleva una
acción `⤓` (hermana del botón, no anidada) — archivo descarga el archivo, carpeta descarga el zip.

**Seguridad (§11).** Ambos endpoints pasan por `resolveSafe` (anti path-traversal) igual que el resto de la
FS API — verificado que `/etc/passwd` y `../../` dan 400 `path_outside_root`. Siguen bajo `requireAuth`.
Verificación de runtime (19/19) con harness sobre el router compilado: MIME correcto y bytes exactos en
imagen, zip válido con estructura anidada (comprobado con `unzip -l`), traversal bloqueado, tope inline y
descarga sin tope. `riesgo` heredado sin cambios: `resolveSafe` no sigue symlinks (aceptable en v1).

## Pendientes de decidir (no inventar; preguntar o resolver en implementación)

- **Ampliar `FS_ROOT`** a todo el servidor (montar `/home/kuoyii` o `/`, o backend en el host) si el
  acceso solo a `servers/` se queda corto — trade-off de seguridad, decidir al usarlo.
- **2FA / passkeys** y colección `users` en Mongo: endurecer auth si el borde lo pide.
- **Multi-VPS por SSH**: si algún día se retoma, definir aquí el modelo.
- **~~Revalorar SSH / backend-en-host~~ → RESUELTO 2026-07-31 (opción a).** Elegido: backend en el host
  (systemd), frontend en Docker. Ver ADR "Backend en el HOST (systemd)" arriba. El código del repo ya
  está migrado; falta la ejecución en el host (`deploy/README.md`), con el orden que ya se advertía:
  **endurecer el borde primero** (Tailscale como paso 0, UFW en el 1) y **luego** el host.
