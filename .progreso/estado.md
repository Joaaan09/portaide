# Estado — checkpoint de la última sesión

> Léeme al empezar. Actualízame al terminar cada sesión.

**Última actualización:** 2026-10-29 (23ª sesión)

## 23ª sesión (2026-10-29) — Fix: abrir conversaciones de Claude Code (VS Code) mostraba el hilo vacío

**Modo Directo** (pedido: "cuando abro una conversación desde portaide que era de aquí claude code, no
veo el historial"). **Commit `39631eb` en `staging` y desplegado** (a petición del usuario). Sin merge a
`main` (falta QA en el iPhone) y sin push.

**Deploy:** backend reiniciado sin sudo (`kill -TERM` al MainPID → systemd `Restart=always` lo relanza;
antes se comprobó que no colgaban turnos de chat ni ptys) → PID 805378, health 200 · `docker compose up -d
--build frontend` → bundle `index-ofgFPMtH.js`. Smoke por el nginx del frontend: health 200, `POST …/open`
sin cookie 401 (llega al backend), PATCH de 1,5 MB → 401 (antes 413).

**Causa:** el hilo del transcript viajaba al cliente y volvía en un PATCH; con >1 MB el nginx del
frontend respondía **413** (default) y el cliente hacía `attach` igualmente → pestaña vacía sin aviso.
**Fix** (ADR en `decisiones.md`): `POST /api/chat/engine/sessions/:id/open` — el server materializa vía
`SessionRuntime.seedFromEngine` (idempotente, no machaca hilo propio, repinta suscriptores); se retira el
`GET …/engine/sessions/:id`. Cliente: `openEngineSession` = POST pequeño + `attach`. `nginx.conf`:
`client_max_body_size 5m` en `/api` (= Express).

**Archivos:** `server/src/chat/{runtime,routes}.ts`, `client/src/views/Chat/chatStore.ts`,
`client/nginx.conf`.

**Verificación:** typecheck + build verdes; `nginx -t` OK con `nginx:alpine`; **E2E HTTP+WS 13/13** contra
un backend aislado (puerto/BD/secreto propios) con el transcript real de 3,4 MB (3984 eventos, POST
~1 s): pestaña ya suscrita recibe el hilo, attach nuevo completo, fila en SQLite, re-open idempotente que
respeta el rename, 400/404/401 y GET antiguo retirado. Reproducido antes el 413 contra el contenedor real.

**Pendiente / siguiente:** **QA en el iPhone** abriendo una conversación grande de VS Code (si la PWA
cacheó el bundle viejo, recargar: el cliente viejo llama al GET retirado y no abriría nada). Si va bien:
merge `staging → main`. Límite: lo que se siga en VS Code tras materializarla no se relee.

## 22ª sesión (2026-10-29) — Editor: pasar de imagen sin volver a Files

**Modo Directo** (pedido: "cuando estoy viendo imágenes … poder pasarlas fácilmente"). **Commiteado
(`3e49139`), merge ff `staging → main` y frontend redeployado** (a petición del usuario). **Sin push.**
Smoke por el nginx del frontend: bundle nuevo `index-CKNX99yn.js` con el visor, `/api/health` 200,
`/api/fs/context` sin cookie 401. Backend no se tocó.

**Hecho:**
- **`client/src/views/Editor/ImageViewer.tsx`** (nuevo; sustituye a `ImagePreview` de `EditorView`):
  imágenes **de la misma carpeta** (orden del explorer, sin bucle). **Swipe horizontal** (la imagen sigue
  al dedo, resistencia en extremos, confirma por distancia o flick), **barra `n / N ‹ ›`** (molde de la del
  PDF; solo con >1 imagen) y **flechas ←/→**. Fetch → blob con **precarga** de anterior/siguiente (LRU 5).
  Entrada direccional de 200 ms (reduced-motion: solo fade). Escenario `data-ptr="off"`.
- **`OpenFilesProvider.replaceFile(from, to)`**: la pestaña se mueve por la carpeta (sin duplicados).
- CSS: `.imageStage` pasa a flex bajo la barra + `.imageSlide` (lo que se desliza); `.zoom` del PDF →
  `.barGroup` genérico; `.barBtnNav` (44px, glifo 20px). DESIGN §7.1 ampliado; ADR en `decisiones.md`.

**Verificación:** typecheck + build verdes; **E2E Chromium móvil 31/31** (toque real por CDP; harness en
el scratchpad de la sesión, receta = la de la 21ª). Capturas revisadas.

**Pendiente / siguiente:** **QA en el iPhone**: umbrales del swipe con el pulgar y fotos reales
grandes/HEIC. Push de `staging`/`main` cuando el usuario lo pida. Propuesto (sin hacer): recortar este
`estado.md` (~49 KB, acumula sesiones) a una foto del ahora.

---

## 21ª sesión (2026-10-29) — Editor: visor de PDF + vista previa de HTML

**Modo Directo** (pedido: "necesito poder previsualizar archivos como html y pdf"). **Commiteado y desplegado.**

**Deploy (2026-10-29):** a petición del usuario, **un único commit en `staging`** con TODO lo pendiente
(esta sesión + 19ª descargas PWA + 20ª explorer + pegar en Terminal). **Sin push.** Frontend redeployado
(`docker compose up -d --build frontend`); backend reiniciado con `kill -TERM` al MainPID (systemd lo
respawnea; no había turnos ni ptys vivos). Smoke por el nginx del frontend: health 200, `/api/preview` con
token falso → 404, `/api/fs/context` sin cookie → 401 y con `Sec-Fetch-Site: cross-site` → 403, SPA nueva.
Typecheck + build verdes; **E2E real en Chromium 45/45** (ver abajo). Corrió **en paralelo** con la 20ª
(explorer) y otra del pegado en Terminal: no comparten archivos de código con esta.

**Hecho:**
- **PDF** (`client/src/views/Editor/PdfPreview.tsx` + `pdfjs.ts`): pdf.js **build legacy** cargado bajo
  demanda (chunk aparte de ~500 KB + worker de 1,2 MB; el bundle principal no crece). Canvas por página,
  solo se pintan las cercanas al viewport y se libera el bitmap de las lejanas (memoria de iOS); placeholders
  con tamaño real; barra `n / N` + zoom `− 100% +` (pasos 100–300 %). Errores (dañado / contraseña / >25 MB)
  → estado con `⤓ Descargar`. Sin capa de texto (no se selecciona texto ni hay enlaces) en v1.
- **HTML** (`HtmlPreview.tsx`): segmented **`Código | Vista`** en la cabecera (abre en Código). Vista =
  `<iframe sandbox>` sin `allow-same-origin` que carga la página y sus **assets relativos** vía token.
  Aviso "sin guardar · se ve lo de disco"; `Guardar` recarga la vista; `↻` manual.
- **Backend**: `server/src/fs/preview.ts` (tokens de capacidad: `POST /api/fs/preview` con sesión →
  `GET /api/preview/<token>/<ruta>` **sin** cookie, montado antes del gate; solo la carpeta del .html, sin
  dotfiles, extensiones web en lista cerrada, TTL 20 min por inactividad, CSP `sandbox` + ACAO `*` +
  `no-referrer`). `fs/mime.ts` (mapa MIME compartido). `/raw` ahora con `CSP: sandbox`.
- **Endurecimiento** (`server/src/auth/site.ts`): la API autenticada y el upgrade de **todos los WS**
  rechazan `Origin: null` y `Sec-Fetch-Site: cross-site|same-site` (antes los WS no miraban el origen).
- Barra de símbolos oculta en visores (imagen/PDF/Vista), con separador que respeta nav + safe-area.
- `fsText.ts` (basename/errText compartidos). **Dep nueva:** `pdfjs-dist@^6.4.299` (ADR). DESIGN §7.2.

**Verificación E2E** (backend de prueba aislado: puerto, BD y FS_ROOT propios; bundle compilado; Chromium
headless con libs extraídas sin instalar): PDF de 3 páginas pintado a 2x, zoom y re-render, indicador de
página, PDF roto → error; HTML con CSS/`<script type=module>`/SVG/`fetch` relativos funcionando; desde el
iframe: origen `null`, cookie/`top`/API/`/ws/terminal`/`.env` **bloqueados**; editar → aviso → guardar
recarga. HTTP: traversal/dotfiles/token falso → 404, cross-site/`Origin null` → 403/401.

**Pendiente / siguiente:** **QA en el iPhone** (PWA) de todo lo desplegado: PDF largo (scroll, memoria, zoom),
.html con assets, y que la app sigue bien tras el guard cross-site (login, chat, terminal, descargas). Más
el QA pendiente de la 19ª (descargas) y la 20ª (explorer). Si todo va bien: push y merge `staging → main`.

---

## 20ª sesión (2026-10-29) — Fix: el explorer recuerda carpetas abiertas al cambiar de vista

**Modo Directo** (bug fix acotado; sin subagentes). **Sin commit ni deploy.** Typecheck + build verdes.

**Síntoma:** en Files, al ir a otra vista y volver, las carpetas abiertas aparecían cerradas.
**Causa:** AppShell desmonta la vista inactiva y la expansión vivía en `useState` de cada `TreeNode`.

**Hecho:**
- **`client/src/views/Files/treeCache.ts`** (nuevo) — estado de módulo que sobrevive al desmontaje:
  `expandedDirs`, `listings` (último listado por carpeta) y `scroll` (ligado al workspace).
- **`FileTree.tsx`** — `TreeNode` y la raíz se inicializan desde la caché y **revalidan en silencio**
  (stale-while-revalidate): sin parpadeo de "cargando…" y recogiendo cambios del agente. Re-expandir una
  carpeta ahora refresca su listado.
- **`FilesView.tsx`** — `onScroll` guarda la posición; `useLayoutEffect` la restaura al volver.
- **DESIGN.md §8** ("Continuidad al navegar") y **ADR 2026-10-29** en `decisiones.md`.

**Segundo fix de la sesión — pegar en la Terminal desde el móvil.** xterm escribe en un textarea oculto, así
que mantener pulsado no ofrece "Pegar" (en PC sí va: Ctrl/Cmd+V llega al textarea). Nueva tecla **`paste`**
en la `KeyBar` (tras `alt`): `navigator.clipboard.readText()` dentro del click (iOS muestra su burbuja
"Pegar") → `TerminalHandle.paste()` → `term.paste()` (normaliza saltos + *bracketed paste*, sale por
`onData` → pty; verificado en el bundle de xterm 6). Desarma ctrl/alt. Sin la API (http no seguro) la tecla
no se pinta. Archivos: `KeyBar.tsx`, `TerminalPane.tsx`, `TerminalView.tsx`; DESIGN.md §9; ADR 2026-10-29.

**Pendiente / siguiente:** QA en el iPhone — (1) Files: abrir carpetas anidadas, bajar con scroll, ir a
Editor/Chat y volver: mismo árbol y misma posición; (2) Terminal: copiar un comando (y un bloque multilínea)
fuera, tocar `paste` → burbuja "Pegar" → el texto entra en el prompt sin ejecutarse línea a línea. Sigue pendiente lo de la 19ª (QA de descargas en la PWA) y la 18ª.
Opcional: persistir `expandedDirs` en `localStorage` para sobrevivir a que iOS mate la PWA.

---

## 19ª sesión (2026-10-27) — Fix: descargar archivos/carpetas en la PWA de iOS (no navegar la página)

**Modo Directo** (bug fix acotado; sin subagentes). **Sin commit ni deploy.** Typecheck + build verdes.

**Síntomas reportados** (dos caras del mismo bug): (1) "descargar carpetas no hace nada, le doy y no pasa
nada"; (2) "al descargar un archivo sale la pantalla blanca de iOS, se descarga, pero para volver tengo que
salir de la app y reabrir".

**Causa.** La descarga de la 18ª era un `<a href download>` que hace una **navegación de nivel de página**.
El `manifest` es `display: standalone` → el WKWebView de iOS **no tiene gestor de descargas ni botón atrás**:
carpeta (`.zip`) → el toque se traga en silencio; archivo → la PWA queda atascada en la vista de descarga.

**Hecho:**
- **`client/src/api/download.ts`** (nuevo) — `isStandaloneDisplay()` + `downloadFsPath(path, name)`: trae
  el recurso con `fetch` (`credentials:'include'` → cookie de sesión, auth intacta) y lo entrega por
  **Web Share API** (`navigator.share({files})` → "Guardar en Archivos"), con fallback a object URL. **No
  toca `document.location`** → la app no se atasca.
- **`client/src/components/DownloadLink/DownloadLink.tsx`** + `.module.css` (nuevo) — enlace reutilizable:
  fuera de la PWA deja el `<a download>` **nativo** (streaming, cero memoria); en standalone intercepta el
  click y usa `downloadFsPath`, con **spinner `--accent`** mientras trabaja (el botón ya nunca queda mudo).
- **Cableado:** `FileTree.tsx` (acción `⤓` por fila; carpeta → `name.zip`) y las **4 descargas** del
  `EditorView.tsx` (cabecera de imagen, binario, fallback de imagen, error de carga). Se quita `fsDownloadUrl`
  de esos dos imports (ahora solo lo usa `DownloadLink`/`download.ts`).
- **DESIGN.md** §7.1 y §8 actualizadas; **ADR 2026-10-27** en `decisiones.md`; compromiso conocido (RAM del
  zip en memoria + *transient activation* de `navigator.share` en zips enormes) en `bugs.md`.

**Verificación:** `npm run typecheck` y `npm --prefix client run build` **verdes**. No hay forma de probar la
Web Share en headless (es específica de iOS) → **falta QA en el iPhone**.

**Pendiente / siguiente:** **QA en el iPhone (PWA)** — (1) descargar un **archivo** desde el Editor y desde
Files: debe aparecer la hoja "Guardar en Archivos" y, al cerrarla, **seguir en la app** (ya NO atascarse);
(2) descargar una **carpeta**: el `⤓` muestra spinner y luego la hoja con el `.zip`. Ojo compromiso: una
carpeta muy grande carga el zip en memoria y, si el `fetch` tarda > ~5 s, `share` puede fallar (ver bugs.md).
Y sigue pendiente lo de la 18ª (QA de ver imágenes inline), que convive con esto.

---

## 18ª sesión (2026-10-23) — FS: ver imágenes inline + descargar archivos y carpetas (zip)

**Modo Directo** (sin subagentes; el usuario respondió "No" al botón rojo). **Commiteado y desplegado.**
Build + typecheck verdes; verificación de runtime 19/19 sobre el router compilado.

**Deploy (2026-10-23):** commit `3da5116` en `staging` + **push a `origin/staging`** (snapshot que además
consolidó la WIP previa sin commitear: Source Control §8.1 y techo de render §6.7). **Frontend
redeployado** por Docker (`docker compose up -d --build frontend`, `portaide-frontend` Up con bundle nuevo).
**Backend reiniciado** vía proceso detached (`kill -TERM` al PID del backend; systemd `Restart=always` lo
respawnea con el `dist` nuevo) — necesario porque esta sesión corre DENTRO del backend y `sudo systemctl`
pide contraseña (restricción "PortaIDE no puede desplegarse a sí misma", ahora en modelo host).

**Pedido:** ver imágenes desde la app, poder descargarlas, y poder descargar carpetas enteras del proyecto.

**Hecho:**
- **Backend `server/src/fs/routes.ts`** — dos GET nuevos bajo el gate de auth:
  - `GET /api/fs/raw?path=` — archivo CRUDO en streaming (`createReadStream`), Content-Type por extensión
    (`MIME_BY_EXT`), `inline` + `nosniff` + `no-store`. Para `<img src>`. Tope inline **25 MB** → 413.
  - `GET /api/fs/download?path=` — **attachment**: archivo tal cual, o **carpeta → zip** al vuelo con
    `archiver` (streaming, sin tope). `Content-Disposition` RFC 5987 (nombres con acentos OK).
  - Ambos por `resolveSafe` (anti path-traversal) → verificado `/etc/passwd` y `../../` dan 400.
- **Dep nueva:** `archiver@^7` (+ **`@types/archiver@^6`**, NO el 8: dejó de declarar la función callable).
  Elegida porque el host no tiene `zip` (solo `tar`) y el backend va en imagen Docker de Node; zip (no
  tar.gz) por iOS. ADR en `decisiones.md` (2026-10-23).
- **Cliente `api/client.ts`** — `isImagePath()`, `fsRawUrl()`, `fsDownloadUrl()` (URLs same-origin → cookie).
- **Editor** (`EditorView.tsx` + `.module.css`) — imágenes se pintan con `<ImagePreview>` desde `/raw`
  (damero para transparencias, spinner, fallback a descarga); botón `⤓ Descargar` en la cabecera; binario
  no-imagen (415) → estado propio `binary` con descarga (ya no error genérico).
- **Files** (`FileTree.tsx` + `FilesView.module.css`) — acción `⤓` por fila (hermana del botón): archivo
  descarga el archivo, carpeta descarga el zip. `rowWrap` nuevo; `.row` pasa a `flex:1`.
- **DESIGN.md** — §7.1 (visor + descarga) y §8 (acción `⤓` por fila).

**Verificación de runtime** (harness `server/__fsverify.mjs`, ya borrado): 19/19 — MIME y bytes exactos en
imagen, zip válido con estructura anidada (`unzip -l`), traversal bloqueado en raw y download, tope inline
25 MB vs descarga sin tope.

**OJO entorno:** el `node_modules` del server estaba instalado en modo producción (faltaban `typescript`,
`tsx`, `@types/*`). Hubo que `npm install --include=dev` en `server/` para typecheck/build. En el VPS real
el despliegue instala prod; las devDeps solo hacen falta para compilar.

**Pendiente / siguiente:** **QA en el iPhone (PWA)** tras el reinicio del backend — abrir una imagen,
descargarla, y descargar una carpeta grande (zip en streaming). La deuda de la 17ª (rebuild del frontend)
queda SALDADA con este deploy. Nota: el reinicio del backend lo disparó un proceso detached, así que esta
sesión de chat se cortó en ese momento (reconexión de la PWA esperada).

---

## 17ª sesión (2026-08-05/06) — Chat: techo de render (la PWA se reiniciaba al volver a la vista)

**Ecosistema de subagentes AUTORIZADO** por el usuario (2 `ejecutor` en paralelo + `revisor`, 2 pasadas).
**Sin commit.** ⚠️ Corrió **en paralelo con la 16ª sesión**, que **redesplegó el frontend a las 23:25**
—antes de que esto terminara—: **el bundle servido tiene una versión INTERMEDIA de este trabajo** (techo
por card sí, ventana buena no). Hace falta **rebuild del frontend** para que llegue lo definitivo.

**Síntoma:** "estoy en Chat, cambio de pestaña, vuelvo y la app peta, como que se reinicia" (PWA en
iPhone). Lo que se ve es el **splash**: la página se recarga entera.

**Causa (medida contra `data/portaide.db`, no supuesta):** `AppShell` remonta la vista al navegar
(`key={view}`) y el hilo se pintaba **sin ningún techo**. La conversación mayor: 3.673 eventos → 632
tool-cards, 10.883 líneas de diff, 3.558 de bash ⇒ **~46.000 nodos DOM** reconstruidos en un commit; eso
mata el WebView en iOS. Dato clave que casi se pasa por alto: **`assistant_done` NO cierra el mensaje del
asistente** (`chatStore.ts:593`), así que **un turno entero es UN item** — hay uno de **576 bloques**.

**Hecho** (DESIGN **§6.7** escrito ANTES de implementar; ADR del 2026-08-05 en `decisiones.md`):
- **Ventana del hilo** (`ChatThread.tsx`): presupuesto **duro de 120 bloques**, **recortando el primer
  item visible por su cola** (`threadWindow` → `{start, skipBlocks}`); botón `▲ Mostrar mensajes
  anteriores` (+120) que **conserva la posición de lectura**; la ventana **no encoge mientras lees hacia
  arriba** (congelación por `frozenRef`, **con tope de 3× el presupuesto** — si no, el turno vivo la
  inflaba hasta 1.020 bloques; volver al fondo la descongela y fuerza render); el presupuesto se resetea
  **en fase de render** al cambiar de conversación; los items revelados **no animan** (Set de ids: por
  posición, la 2ª ampliación les quitaba la clase y CSS **arrancaba** la animación).
- **Techo por card** (`ToolCards.tsx`): diff **24 líneas**, bash **16**, con `⋯ N líneas más` que expande
  esa card; expansión **efímera** a propósito (si se recordara, volver a la vista repetiría el pico).
- **`AssistantMessage` memoizado** (verificado: el store reemplaza items por objetos nuevos, nunca muta).
- **Hilo y composer fuera del pull-to-refresh** (`data-ptr="off"`): arrastrar hacia abajo en el hilo
  llamaba a `location.reload()` — **segunda vía al mismo síntoma**. La recarga sigue en la cabecera.

**Verificado:** `typecheck` + `build` verdes y **medición con la `threadWindow` extraída del propio
archivo** (esbuild) sobre el ensamblado real del hilo, contra una **copia** de la base: **120 bloques
exactos** en las 5 conversaciones mayores y **46.047 → 2.538 nodos** en el peor caso (**18×**).

⚠ **Lección de la sesión:** la 1ª entrega fue **RECHAZADA** por el `revisor` — la ventana contaba **por
mensajes** (mínimo 6 items) y no acotaba nada en la conversación culpable (638 de 844 bloques), y la
medición que la avalaba era **falsa**: el script troceaba los items en `assistant_done`. Se llegó a dar
una cifra errónea al usuario y hubo que corregirla. **Medir con el ensamblador real, no con una réplica.**

**Falta QA en dispositivo** (tras rebuild del frontend): abrir la conversación larga ("tienes los archivos
de diseño…") en la PWA → cambiar de vista y volver **5 veces seguidas** (no debe reiniciarse) → pulsar
`▲ Mostrar mensajes anteriores` y comprobar que no salta lo que estabas leyendo → expandir un diff largo
con `⋯ N líneas más` → arrastrar hacia abajo dentro del hilo y del composer (**no** debe recargar) y
comprobar que en la cabecera de pestañas **sí** recarga.

## 16ª sesión (2026-08-05) — las preguntas de Claude ya se pueden responder (frontend desplegado)

**Modo Directo.** Corrió **en paralelo con la 15ª** (otra sesión de Claude en el mismo repo): el reinicio
del backend de las 22:51 es suyo, no mío. **Sin commit.**

**Petición:** "las preguntas que me hace Claude no tengo manera de responderlas".

**Causa (la misma raíz que la 15ª):** cliente nuevo contra backend viejo. El frontend desplegado (4-ago
15:16) ya traía la `QuestionCard`, pero el proceso `portaide-backend` (vivo desde el 1-ago) no emitía
`question_request` ni entendía el verbo `answer` → la card se pintaba desde el `tool_use` **sin
`requestId`** y `QuestionCard.tsx:45` la deja en modo lectura: **"Sin responder", sin botones**.

**Pista falsa importante (anotada en `decisiones.md`):** el journal del backend repite
`[CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] canUseTool will not be invoked… use a PreToolUse hook instead`. Es un
aviso **genérico y no aplica a `AskUserQuestion`**: verificado con sonda contra el SDK 0.3.198 que esa tool
**sí** pasa por `canUseTool` en `bypassPermissions` y se contesta con `updatedInput.answers`. El bridge no
necesita hooks; quien lea ese warning y "arregle" el puente romperá algo que funciona.

**Hecho:** `npm run build` de server y client (verdes) + **rebuild del frontend**
(`docker compose up -d --build frontend`): el bundle servido ya incluye el trabajo de las sesiones 13 y 14
(chip `@carpeta` del chat, panel **Source Control**, marcas git en el árbol) además de las preguntas.

**Verificado (3 sondas reales, no supuestos):** (1) SDK: `canUseTool` invocado para `AskUserQuestion` en
bypass y `answers` aceptadas; (2) bridge compilado: `question_request` → `resolveQuestion` → `tool_result
ok` → `result success`; (3) **end-to-end por el camino real de la app** (login HTTP → `ws://…/ws/chat` →
`attach`+`message` → `question_request` → **`answer`** → `question_answered` → `tool_result ok`) contra el
backend desplegado. Además smoke autenticado: `/api/chat/sessions` 200 y `/api/git/status` devuelve el repo
real con `tokenPresent: true`. La sesión de prueba se borró de SQLite.

**Falta QA en dispositivo:** pedirle a Claude que use `AskUserQuestion` (una pregunta, varias, y
multiSelect) → la card debe salir con botones, "Otro…" con texto libre y **Enviar respuestas** habilitado
solo al contestarlas todas. Y de propina, probar el panel de git y el chip de proyecto, que se han
desplegado con este rebuild sin haber pasado por device.

**Basura de las sondas que no pude borrar** (el classifier bloqueó el `rm`): 3 transcripts del engine con
el texto "Usa AHORA la herramienta AskUserQuestion…" — uno en `~/.claude/projects/-home-kuoyii-servers-portaide/`
(`03add051-…jsonl`, se ve en el historial "En el servidor") y dos en `~/.claude/projects/-tmp/`.

## 15ª sesión (2026-08-05) — el chat YA responde en caliente: era el backend sin reiniciar

**Modo Directo.** **Sin commit.** **CON DESPLIEGUE del backend** (autorizado por el usuario).

**Petición:** "cuando mando un mensaje mientras me está respondiendo, me lo responde cuando termina el
anterior; quiero que sea inmediato, como Claude Code".

**No era código: era despliegue.** El servicio `portaide-backend` (systemd, host) llevaba corriendo desde
el **1-ago 18:04** con el código de `HEAD` (`23419bd`), que encola el mensaje si hay turno vivo. La entrega
en caliente de la 12ª sesión estaba escrita y compilada en `dist/` (4-ago 17:14) pero **nunca se reinició
el proceso**. El frontend sí se había reconstruido (4-ago 20:09) → **cliente nuevo + backend viejo**: el
composer dejaba escribir, el servidor encolaba. Síntoma exacto del usuario.

**Hecho:** typecheck verde → `npm run build` en `server/` → reinicio (sin sudo en la sesión: `kill -TERM`
al PID; el unit corre como `kuoyii` con `Restart=always` → systemd relanzó solo, PID 3982645, health 200).

**Verificado con sonda real** contra `dist/chat/bridge.js`: tarea de 12 pasos Bash, `push()` a los 8 s →
el agente **responde a los 15,1 s tras 1 de 12 pasos**, misma query, sin `resume`. (La 1ª sonda no valía:
el sandbox del CLI bloquea `sleep 25 && echo …` y el turno moría a los 6 s.)

**Efecto colateral querido:** al desplegar el `dist` actual, el backend sube también la **13ª sesión**
(ancla de proyecto `cwd`), las **preguntas `AskUserQuestion`** y el **backend de git** de la 14ª — que ya
tenían su mitad de cliente desplegada desde el 4-ago.

**Lección operativa (repetible):** desplegar SIEMPRE con `bash scripts/deploy.sh` (hace build + `systemctl
restart` + rebuild del frontend). Un `docker compose up -d --build` solo toca el frontend; un `npm run
build` suelto deja el `dist/` nuevo con el proceso viejo en memoria.

**El reinicio era necesario pero NO suficiente: había un bug real** (encontrado al verificar el camino de
producción, no el del bridge suelto). Medido contra el CLI: al inyectar con `priority:'now'` el CLI **corta
el paso en curso y emite un `result`** —el del turno CORTADO, no el del mensaje nuevo—. `SessionRuntime`
veía ese `result` con la cola vacía → `feedNextOrClose()` → `endInput()` → **cerraba el canal justo cuando
el agente iba a atender la inyección**. Resultado en 2 de 2 sondas: el mensaje se pospuso al final de la
tarea (43,6 s) o **se perdió del todo** —y sin salir por `onDropped`, porque el CLI ya lo había recogido
del canal: pérdida silenciosa—.

**Fix (`bridge.ts`, quirúrgico):** flag `injectedLive` + `resultsSincePush`. Mientras hay una inyección sin
atender, `closeInput()` NO cierra: aplaza con `INJECTED_GRACE_MS` (20 s, red de seguridad; tras el corte
hay huecos de >10 s de silencio del CLI). El **1er** `result` tras el push es el del corte y no levanta el
bloqueo; del **2º** en adelante sí → el cierre vuelve al camino rápido y el slot se libera igual de pronto.
Sin inyección, el comportamiento es idéntico al anterior (cero regresión).

**Verificado (4 sondas, camino de producción con `endInput()` en cada `result`):** sin fix → 2/2 mal
(pospuesto / perdido); con fix → el mensaje siempre entra, y con una orden real de parar a mitad
(«DETENTE, no ejecutes más comandos») el agente **acusa a los 1,6 s del envío y corta la tarea en el paso
2 de 12**, con el turno cerrado 0,6 s después. Ojo al matiz: con un «ignora lo anterior» el modelo a veces
elige **terminar** lo que estaba haciendo antes de responder — eso es decisión suya, no retraso del
transporte.

**Falta QA en dispositivo:** lanzar algo largo en el Chat y **escribir a mitad** → la burbuja debe aparecer
intercalada y el agente atenderla sin esperar al final. Y, ya de paso, lo pendiente de la 13ª/14ª (chip
`@carpeta`, `AskUserQuestion`, Source Control), que ahora sí tienen backend.

## 14ª sesión (2026-08-04) — Source Control: git desde la UI (commit, push, pull) sin terminal

**Modo Directo** (autorizado tras el protocolo del botón rojo). **Sin commit ni deploy.**

**Petición:** "integrar GitHub para poder hacer commit, push, pull… sin usar la terminal".
**Decisiones del usuario:** alcance esencial (sin diff línea a línea) · credencial por **token de GitHub**
(ya lo puso él en `.env` como `GITHUB_TOKEN` durante la sesión).

**Hecho** (DESIGN **§8.1** escrito ANTES de implementar; ADR del 2026-08-04 en `decisiones.md`):
- **Backend nuevo `server/src/git/`**: `service.ts` habla con el binario `git` por `execFile` (sin shell)
  y parsea `status --porcelain=v2 --branch -z`; `routes.ts` monta 8 endpoints en `/api/git` bajo el gate de
  auth (`status`, `branches`, `stage`, `unstage`, `commit`, `fetch`, `pull`, `push`, `checkout`).
  **Mutex por repo** (el `index.lock` no admite dos operaciones a la vez), toda mutación sobre la raíz que
  da `rev-parse --show-toplevel` (validada dentro de `FS_ROOT`), rutas del cliente siempre tras `--`,
  y errores de git **traducidos** a códigos que la UI explica (`diverged`, `rejected`, `auth_required`…).
- **Credencial**: `GITHUB_TOKEN` → subproceso por **env** + *credential helper* efímero. Nunca en argv
  (`ps aux`), nunca en `.git/config`, nunca al cliente (solo un booleano `tokenPresent`).
  `GIT_TERMINAL_PROMPT=0` para que ningún `git` se quede colgado pidiendo contraseña.
  `env.ts` valida el formato del token y avisa si falta. Nuevas: `GITHUB_TOKEN`, `GIT_AUTHOR_NAME/EMAIL`.
- **Cliente**: `api/git.ts`, `useGitStatus` (una sola fuente de verdad; refresco silencioso al volver a la
  app), **panel `SourceControl`** en hoja inferior (rama + crear/cambiar, ↓Bajar/↑Subir con contadores,
  listas PREPARADOS/CAMBIOS con `+`/`−`, mensaje + Guardar cambios, tira de resultado), **chip de rama**
  en la cabecera de Files (solo si la carpeta es un repo) y **marcas M/A/D/?/R** en el árbol del explorer
  (pendiente que estaba en el plan). `ApiError` ahora arrastra el `detail` del backend.
- **Alcance sin nada destructivo** (regla dura): `pull --ff-only`; nada de force-push, `reset --hard`,
  descartar cambios, stash ni resolución de conflictos → el panel lo dice y remite a la Terminal.

**Verificado:** typecheck + build (server tsc + client vite) **verdes**; **39 pruebas reales** del módulo
contra repos de verdad (parseo de rutas con espacios y comillas, renombrados con origen, repo sin commits,
guards de traversal/flags, ramas, concurrencia, y un **`fetch` autenticado REAL contra GitHub con tu
token** → la credencial funciona) y **19 smoke HTTP** contra el server levantado en el 4199 (gate de auth
401, status, stage, commit, errores 400/409 con código, checkout, y **que el token no aparece en ninguna
respuesta**). Dos bugs propios encontrados en la relectura del diff y corregidos: las carpetas nuevas
llegan con `/` final (la marca del árbol nunca casaba) y faltaba el focus-trap del diálogo.

**Falta QA en dispositivo:** abrir Files en un repo → el chip `⑂ rama` con su punto amarillo → tocarlo →
preparar archivos, escribir mensaje, **Guardar cambios**, **Subir** (primer push real con el token) →
comprobar que el commit aparece en GitHub; probar **Bajar**, crear rama y cambiar de rama; ver las letras
de estado en el árbol. Ojo: el primer **push real** no se ha ejecutado (no toco tu remoto sin permiso).

## 13ª sesión (2026-08-04) — Chat: cada conversación anclada a su proyecto (chip `@carpeta` editable)

**Modo Directo** (autorizado tras el protocolo del botón rojo). **Sin commit ni deploy.**
⚠️ Esta sesión corrió **en paralelo** con la 12ª (otra sesión de Claude escribiendo los mismos archivos del
Chat). El usuario decidió seguir; las ediciones fueron quirúrgicas y el build final incluye ambas.

**Petición:** "cuando abres un chat te tiene que indicar a qué proyecto hace referencia" + poder cambiar la
carpeta desde ahí, **solo en conversaciones no iniciadas**.

**Causa real:** el chip `@…` pintaba el **workspace global** y el `cwd` viajaba **por mensaje** con ese
valor → cambiar de carpeta en Files movía de proyecto a todos los chats, incluidos los que ya tenían hilo.
La columna `cwd` de SQLite existía pero **nunca se escribía**.

**Hecho:**
- **Servidor (autoritativo):** `SessionRuntime` **ancla** la carpeta del primer turno, ignora el `cwd` de
  los mensajes posteriores, la persiste y la publica en el `snapshot`. `PATCH /api/chat/sessions/:id`
  acepta `cwd` validado con el nuevo **`resolveDirSafe`** (`fs/paths.ts`: bajo `FS_ROOT` + directorio
  existente → 400 `bad_cwd`); `upsertSession` ya escribe la columna. `ws.ts` reusa el helper.
- **Cliente:** `ChatSession.cwd` + `defaultCwd` en el store (workspace activo, sincronizado por la vista),
  `setSessionCwd` con guard `isChatStarted()`, ancla al primer envío, y `cwd` arrastrado en
  `loadSessions`/`reopenSession`/`openEngineSession`/`fetchHistory`. El **chip del composer** muestra el
  proyecto (ruta relativa a la raíz, truncada por delante) y es **botón → `FolderPicker`** con el hilo
  vacío; **candado** en cuanto arranca. El historial del engine se lista por el proyecto del chat activo.
- **`FolderPicker` extraído** a `client/src/components/FolderPicker/` (lo usan Files y Chat).
- **DESIGN.md §6.6** escrito con el patrón del chip; ADR del 2026-08-04 en `decisiones.md`.

**Verificado:** typecheck + build verdes + **pruebas reales**: contra SQLite (alta con ancla, `persistNow`
sin `cwd` no la borra, cambio en chat sin estrenar, aparece en la lista) y contra el **`SessionRuntime`
real** con el puente stubbeado (1er turno fija el ancla; **2º mensaje con otra carpeta la ignora**; se
persiste; el `snapshot` la publica). `resolveDirSafe` rechaza fichero, `/etc`, traversal e inexistente.

**Falta QA en dispositivo:** chat nuevo → el chip muestra la carpeta del workspace y al tocarlo abre el
selector → elegir otra → enviar el 1er mensaje → el chip queda con candado; cambiar de carpeta en Files y
comprobar que ese chat **sigue** en su proyecto; abrir una conversación del historial y ver su carpeta.

## 12ª sesión (2026-08-04) — Chat: escribir sin esperar + preguntas de Claude con opciones

**Modo Directo** (el usuario autorizó solo el subagente `revisor` al cierre). **Sin commit ni deploy.**

**(1) Escribir sin esperar — ENTREGA EN CALIENTE.** Primero se quitó el bloqueo de UI (la cola del server
ya existía), pero eso hacía esperar al mensaje hasta que terminaba el turno anterior; el usuario pidió lo
de Claude Code: que entre **mientras** trabaja. Rehecho sobre el **streaming input** del SDK
(`query({prompt: AsyncIterable})`): `ChatTurn.push()` inyecta el mensaje en la sesión viva y el agente lo
atiende sobre la marcha; su burbuja aparece **intercalada** en el trabajo. Clave medida: **`priority:
'now'` es obligatorio** — sin él, el CLI consume el mensaje y **lo descarta** (pérdida silenciosa).
Bonus: los mensajes encadenados van por la misma query, **sin `resume` ni relanzar `claude`** (2.7 s vs
~5 s). La cola (y su chip **"⏳ En cola"** con **Cancelar**) queda para lo que no se puede entregar:
turno esperando slot, o mensaje con otro modelo/esfuerzo. Composer nunca bloqueado (`↑` si hay texto;
`■` solo con el campo vacío y turno vivo; placeholder "Escribe sin esperar…").

**(2) Preguntas (`AskUserQuestion`).** Antes solo había Approve/Reject: aprobar mandaba el input **sin
respuestas**, así que el agente volvía a preguntar. Verificado contra el SDK real (esa tool **sí** pasa
por `canUseTool` incluso en `bypassPermissions`; se contesta con `updatedInput.answers`, multiSelect
separado por ", ", admite texto libre). Nuevos: evento `question_request`, verbo `answer`,
`resolveQuestion` (bridge+runtime) y **`QuestionCard`** en el cliente — selección única/múltiple, 1–4
preguntas apiladas, "Otro…" con texto libre, y envío deshabilitado hasta responderlas **todas** (contestar
a medias hace que el agente repregunte). DESIGN.md **§6.4 y §6.5** escritos antes de implementar.

**Fleco preexistente corregido:** las resoluciones (`permission_resolved`/`question_answered`) entran al
log del hilo → aprobar/responder y recargar ya no repinta la card pidiendo la decisión otra vez.

**Revisión (subagente `revisor`, autorizado por el usuario).** Veredicto: aprobado con reservas; los 2
altos y los medios accionables **ya están corregidos y re-verificados**:

1. Interrumpir con una pregunta viva no dejaba resolución en el log (el deny del `abort` no emitía) → se
   emite, **y** al resucitar una sesión desde SQLite se cierran las peticiones huérfanas
   (`closeOrphanRequests`). Antes: responder era un no-op mientras la UI decía "✓ respondida".
2. `stop()` sin turno vivo no reemitía `status` → la cola seguía pintada con un Cancelar inútil.
3. `cancelQueued` cancela también el mensaje que **espera slot** y deja **lápida** (un reenvío
   at-least-once ya no lo resucita). 4. `markQuestion` reemplaza una card genérica en vez de dejarla
   muerta. 5. `status` sin `queue` ya no borra la cola pintada. 6. `pendingPerm` se limpia al cerrar
   pestaña. 7. A11y: `role="group"` + `aria-pressed` (el `radiogroup` sin flechas incumplía ARIA).
   8. CSS: `Cancelar` en `--dim` (una regla de orden lo pintaba en `--accent`), botones ≥44px, resumen en
   `--faint` y `✕ Descartada` en `--red`, según DESIGN §6.5.

Lo no arreglado está en **`bugs.md`** (lo más relevante: una pregunta sin responder **retiene un slot de
concurrencia** indefinidamente — preexistente, a decidir: auto-deny por tiempo o liberar el slot).

**Revisión #2 (streaming input).** El `revisor` reprodujo 2 altos en el camino estrella, ya corregidos y
re-verificados: (a) contar `result`s para cerrar el canal era falso —el CLI funde mensajes seguidos en un
turno— y el turno retenía slot **30 s** de más (ahora se cierra cuando el CLI ha recogido del canal:
**0,4 s**); (b) al escribir con una card/pregunta abierta se marcaba **"✕ Rejected"** algo que el usuario
no rechazó (ahora `reason:'interrupted'` → **⚠ Interrumpido** en `--yellow`). Además: aviso en el hilo si
un mensaje inyectado muere con el turno; el **permiso** entra en la compatibilidad (evitaba ejecutar con
bypass algo puesto en Ask, §11); `setModel`/`setPermissionMode` sincronizan el estado del turno; sin
burbuja de asistente vacía; sin frame duplicado al encadenar; `shutdown` no arranca turnos. Lo menor, en
`bugs.md`.

**Verificado:** `npm run build` verde y **sondas reales contra el engine** (no hay tests en el repo) — de la entrega en caliente: la query
sobrevive al `result` y encadena sin `resume`; `priority:'now'` es imprescindible (`next`/sin campo
descartan el mensaje); el texto inyectado llega de verdad (el agente escribió un código que solo estaba
en ese mensaje); `resume` y `stop` intactos; encadenado desde cola en la misma sesión. Y de la tanda
anterior (sondas del SDK; puente respondiendo 2
preguntas single+multi; runtime encolando/cancelando; cancelación de lo que espera slot + lápida + status
tras `stop`; reconciliación de huérfanas; interrupción con pregunta viva → deja `permission_resolved`).
**Falta QA en iPhone:** lanzar algo largo y **escribir a mitad** → la burbuja debe aparecer intercalada y
el agente tenerlo en cuenta sin esperar al final; mandar 2–3 seguidos; `■` con el campo vacío; pedirle a
Claude que use `AskUserQuestion` (single, multi y varias preguntas) y responder desde la card.

⚠ **Revalidar `npm run build` justo antes de commitear**: hay otra sesión tocando los mismos ficheros del
Chat (durante la revisión el árbol llegó a no compilar por `ChatView.tsx`).

> **Aviso:** durante esta sesión aparecieron en el árbol cambios **de otra sesión** (ancla de proyecto
> `cwd` en `runtime.ts`/`store`/`types.ts`/`ws.ts`, `resolveDirSafe`). No son míos y se han respetado;
> el build final los incluye.

## 11ª sesión (2026-08-01) — dos fixes de Terminal en móvil (barra de teclas + auto-repeat del backspace)

## 11ª sesión (2026-08-01) — dos fixes de Terminal en móvil (barra de teclas + auto-repeat del backspace)

Dos arreglos, ambos en **Modo Directo**, **sin commit ni deploy**, pendientes de **QA en iPhone**:

**(B) Backspace mantenido no se repite (iOS).** Al mantener pulsado el borrado del teclado del iPhone
se borraba de uno en uno. Causa: iOS **no emite `keydown` repetidos** para el teclado virtual; el primer
toque sí llega (xterm borra un carácter) pero el hold se queda mudo. Fix: helper `attachBackspaceRepeat`
en `TerminalPane.tsx` sobre `term.textarea` → tras 400ms reenvía `DEL` (`SEQ.del`, nuevo en `keys.ts`)
cada 55ms hasta `keyup` (tope 500). Guardas: solo `pointer: coarse` y solo si `event.repeat` es falso (no
duplica la repetición nativa de escritorio/teclado físico); listeners en captura. ADR 2026-08-01. **Supuesto
a validar en device:** que iOS emite el `keydown`/`keyup` inicial de Backspace (el toque suelto ya borra,
así que el keydown es casi seguro).

**(A) Barra de teclas tapada por el teclado.** (ver detalle abajo)

## 11ª sesión (2026-08-01) — fix: barra de teclas del Terminal tapada por el teclado del móvil

**Petición:** "en Terminal, al escribir no veo el teclado de la app (esc, ctrl…)". La `KeyBar` quedaba
**detrás del teclado del sistema**.

**Causa:** el marco `AppShell .shell` (`position: fixed; inset: 0`) está anclado a la layout viewport, que
**no se encoge** al abrir el teclado (decisión deliberada del shell). El teclado se pinta encima del borde
inferior → tapa la barra. No había ninguna lógica de `visualViewport` en el proyecto.

**Fix (Modo Directo, scoped al Terminal — NO toco la shell global):**
- **`hooks/useKeyboardInset.ts`** (nuevo): publica en `<html>` la var `--kb-inset` = solape del teclado,
  medido con `window.visualViewport` (`innerHeight - vv.height - vv.offsetTop`, coalescido en rAF, umbral
  80px; no-op si no hay soporte → sin regresión).
- **`TerminalView.tsx`**: llama al hook.
- **`TerminalView.module.css`**: `.view` reserva `padding-bottom: var(--kb-inset)` (sube la columna; el
  `ResizeObserver`+`FitAddon` de `TerminalPane` reajusta la terminal solo y el prompt queda visible); la
  `.keybar` descuenta ese solape de su holgura nav/safe-area con `max(0, nav+safe - kb)`.
- **`tokens.css`**: token `--kb-inset: 0px` (default).

**Verificado:** typecheck + build verdes. Detalle y alternativas descartadas (`interactive-widget` no lo
soporta Safari iOS; flotar solo la barra dejaría el prompt tapado) en ADR 2026-08-01 de `decisiones.md`.
**Sin commit ni deploy.** Falta **QA en dispositivo**: Terminal → teclear → la barra `esc/ctrl/…` debe
verse pegada sobre el teclado, y el prompt justo encima. Nota: el composer del Chat puede tener el mismo
problema latente; si aparece, subir `--kb-inset` a la shell/Chat (el patrón ya está listo para reusar).

## 10ª sesión (2026-08-01) — historial del engine (conversaciones del VPS) cableado en la UI

**Petición:** "quiero ver el historial de conversaciones que hay en el VPS" (ya con Tailscale + host).
**No era Tailscale.** El backend para leer los transcripts reales del engine (`~/.claude/projects/*.jsonl`,
incl. VS Code) **ya existía y estaba verificado** (ADR 2026-07-06) pero la **UI nunca se cableó**; el panel
solo listaba las sesiones SQLite nacidas en PortaIDE. Cableado en **Modo Directo** (autorizado por el
usuario), **sin tocar el backend**:

- **`chatStore.ts`**: `fetchEngineHistory(cwd)` (lista del engine, por proyecto) + `openEngineSession`
  (descarga el transcript → lo **materializa en SQLite** vía upsert con `thread`+`claudeSessionId` reusando
  el sessionId del engine como id → `attach` repinta y `resume` continúa). `fetchHistory` ahora expone
  `claudeSessionId` para dedup.
- **`useChatSession.ts`** (fachada), **`ChatView.tsx`** (pasa el `workspace` como cwd + `onOpenEngine`).
- **`ChatHistory.tsx` + `.module.css`**: panel en **2 secciones** — *PortaIDE* (SQLite) y *En el servidor ·
  Claude Code* (engine del proyecto), con **dedup** por `id ∪ claudeSessionId`.

**Verificado:** typecheck + build (server tsc + client vite) **verdes**. Detalle y alternativas en
`decisiones.md` (ADR 2026-08-01). **Sin commit ni deploy.** Falta **QA en dispositivo** tras desplegar:
abrir el panel → sección "En el servidor" con las conversaciones del proyecto → tocar una → repinta el hilo
y se puede continuar (resume). Recordatorio: el engine es **por proyecto**, así que depende del workspace
abierto (raíz por defecto `/home/kuoyii/servers`).

## 9ª sesión (2026-07-31) — fix del selector de carpeta + migración backend→host (repo)

Dos cosas, ambas **sin commit ni deploy**:

1. **Fix UI:** el botón "Open this folder" del `FolderPicker` quedaba tapado por la barra inferior en
   móvil (overlay atrapado en el contexto de apilamiento de `.viewport`). Solución: `createPortal` a
   `document.body` + `z-index:200`. Archivos: `client/src/views/Files/FolderPicker.tsx`,
   `FilesView.module.css`.

2. **Decisión de arquitectura + migración (ADR 2026-07-31 en decisiones.md):** se movió el **backend al
   HOST (systemd)**; el frontend sigue en Docker. Objetivo: Terminal = shell real del VPS (clauded,
   docker, logs) y deploy desde la propia app. **El lado-repo está hecho y con typecheck verde**;
   falta ejecutar los pasos del host (ver `deploy/README.md`). SSH quedó descartado (PortaIDE vive en el
   mismo VPS). Cambios: `docker-compose.yml`, `client/nginx.conf`, `server/src/config/env.ts` + `index.ts`
   (nuevo `HOST`), `deploy/portaide-backend.service`, `scripts/deploy.sh`, `deploy/README.md`, `.env.example`.

### PENDIENTE de esta sesión — acción del host (no ejecutable desde el contenedor)

Seguir **`deploy/README.md`** en el host, en orden: **paso 0 Tailscale** (endurecer el borde, innegociable)
→ paso 1 UFW (cerrar 4100) → `npm ci && build` en el host → systemd `enable --now` → rebuild frontend →
bajar el `portaide-backend` de Docker viejo → verificar (whoami=kuoyii, docker ps, tarjetas del chat).
El fix del selector de carpeta se despliega **junto** con esto (o antes, con el compose actual si no migras aún).

## Dónde estamos

**Fase 3 desplegada y funcional** (login, terminal real, filesystem, editor y chat con Claude real).
Sobre eso, la 8ª sesión ha cerrado el **trabajo en segundo plano de verdad**: se puede lanzar trabajo,
bloquear el móvil o salir de la app, y seguir. Rama: `staging`.

⚠️ **Estado real de despliegue (2026-08-05):** el trabajo de las sesiones 12ª–14ª sigue **SIN COMMIT**,
pero **SÍ está corriendo**: el frontend desde el 4-ago (Docker) y el backend desde el 5-ago (systemd,
tras el reinicio de la 15ª sesión). Es decir, `staging` en git va **por detrás** de lo desplegado.
Pendiente: commitear ese trabajo.

## 8ª sesión (2026-07-26) — trabajo en 2º plano, terminal persistente y push

**Diagnóstico medido contra el VPS real** (no supuesto): cortando el WS a la fuerza, el **Chat ya
sobrevivía** (60 s de trabajo completados sin cliente; el `snapshot` lo recuperaba todo) pero la
**Terminal moría**. El "parece parado" del Chat era del cliente: socket **zombi en `OPEN`** y ningún
listener de ciclo de vida. Detalle en `decisiones.md` (4 ADRs nuevos).

**Implementado (typecheck + build VERDES en server y client):**

1. **`server/src/terminal/runtime.ts`** — el pty ya no muere con el socket: `TerminalRuntime` con ring
   buffer de 256 KiB, protocolo multiplexado (`attach|input|resize|detach|kill` → `snapshot|data|exit|
   error`), **sesiones muertas retenidas** (para enterarte de que tu `clauded` murió, con su `exitCode`),
   reaper de huérfanos a 2 h y cota `TERMINAL_MAX_SESSIONS=6`. Arreglado: el `cwd` del cliente se ignoraba.
2. **`server/src/ws/heartbeat.ts`** — ping/pong (30 s) que hace `terminate()` de los sockets fantasma.
   Sin esto el server creía que seguías mirando y el push nunca se dispararía.
3. **Cliente Terminal** — `terminalStore` singleton, pestañas en localStorage, `detach` (NUNCA `kill`) al
   cambiar de vista, reconexión con backoff+jitter y aviso de sesión terminada con "Reiniciar shell".
4. **Cliente Chat** — detección de zombi por `lastFrameAt`, listeners `visibilitychange`/`pageshow`/
   `focus`/`online`, **`ack` del servidor** con reenvío de no confirmados (+ guard de **idempotencia por
   `localId`** en `runtime.ts`: un reenvío no puede ejecutar el turno dos veces), ids deterministas,
   scroll que respeta dónde leías, y fuera la "sesión fantasma" cuando falla la carga inicial.
5. **Web Push (VAPID)** — `server/src/push/*` + `client/public/sw.js` + panel en Settings. Avisos:
   **"sigue trabajando"** (al irte con turno vivo, debounce 20 s) y **"terminó/falló"**, mismo `tag` por
   sesión (el segundo reemplaza al primero).
6. **Refactor** — `client/src/components/ConnBanner/` compartido por Chat y Terminal (DESIGN §6.3).

**Ciclo de revisión (importante):** la primera entrega fue **RECHAZADA** por el `revisor` con 2 críticos
reproducidos (el borrado por id que mataba al runtime sucesor dejando `bash -l` huérfanos; el guard de
idempotencia que no cubría la espera de slot) + 4 altos/medios. Corregidos todos y re-verificados con repros
antes/después. La 2ª pasada destapó 2 altos más, **preexistentes**, también corregidos y verificados: la
exclusión mutua por sesión (`if (this.turn)` no cubría la espera de slot → dos agentes en paralelo sobre el
mismo repo) y el flag `stopped` pegajoso (se tragaba en silencio el siguiente mensaje del usuario). Veredicto
final: **desplegable**. Lo que se dejó sin arreglar está en `bugs.md`, todo menor.

## PENDIENTE — acción del usuario

1. **Commit + deploy** (el deploy va EN EL HOST, no desde PortaIDE):
   `cd /home/kuoyii/servers/portaide && docker compose up -d --build`.
   ⚠️ El protocolo de `/ws/terminal` **cambió sin retrocompatibilidad**: hasta desplegar, cliente y
   servidor viejos siguen siendo coherentes entre sí, pero no mezcles versiones.
2. **QA en el iPhone tras desplegar** (nada de esto se ha probado en dispositivo real):
   - **Instalar la PWA en la pantalla de inicio** — en iOS el push NO llega desde Safari normal.
   - Settings → Notificaciones → activar → **"Enviar notificación de prueba"**.
   - Terminal: lanzar algo largo, cambiar de vista / bloquear el móvil / volver → debe seguir y repintar.
   - Chat: enviar, bloquear el móvil, volver → debe seguir y llegar el push al terminar.
3. **Activar "Websockets Support"** en el proxy host de NPM (pendiente de sesiones anteriores; sin esto
   terminal y chat no conectan).
4. **Cambiar `AUTH_PASSWORD`** en `.env` (la actual es débil y viajó en claro por el chat) y redesplegar.

## Cómo entrar

- **URL**: la configurada en Nginx Proxy Manager → `portaide-frontend`. Credenciales y secretos en
  `/home/kuoyii/servers/portaide/.env` (gitignored, chmod 600): `SESSION_SECRET`, `AUTH_EMAIL`,
  `AUTH_PASSWORD` y las 3 `VAPID_*` nuevas. Backend en el 4100 (interno).
- Los `MONGO_*` del `.env` ya no se usan (borrables); el volumen `portaide_mongo_data` y el contenedor
  `portaide-mongo` quedaron huérfanos tras la migración a SQLite y pueden eliminarse.

## Flecos conocidos (ver bugs.md) — no bloqueantes

- Nada de la 8ª sesión está probado en runtime con navegador (sí con pruebas reales de pty y de las rutas
  HTTP de push, pero no en un iPhone).
- Deep-link del push: al pulsar la notificación con la app ya abierta navega al Chat y selecciona la
  sesión; en arranque en frío depende de `portaide:chat:activeId`.
- Files no muestra estado git por archivo (falta endpoint git-status).
- Editor: split-terminal aplazado a v2; undo se reinicia al cambiar de pestaña.
- FS: `resolveSafe` no resuelve symlinks (aceptable v1, un solo usuario).
- La terminal descarta las teclas pulsadas mientras no hay socket (decisión: reenviarlas podría ejecutar
  comandos fuera de contexto).

## Siguiente

1. Commit (separando lógicamente si procede) + deploy + QA en el iPhone.
2. **Decidir lo de "ver los logs desde PortaIDE"**: la premisa del SSH era falsa (`~/.claude` y
   `/home/kuoyii/servers` ya están montados del host; lo único que falta es acceso a Docker, cuyo montaje
   está comentado en `docker-compose.yml:49`). Ver el ADR de 2026-07-26 en `decisiones.md`: opción 1
   (backend en el host con systemd) u opción 2 (montar el socket), **no** SSH con contraseña.
3. Candidatas: git-status en el explorer, split-terminal, endurecer symlinks, 2FA/passkeys.
