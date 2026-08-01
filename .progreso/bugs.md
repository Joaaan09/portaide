# Bugs — pendientes conocidos

> Bugs detectados que NO se arreglaron en el momento. Formato: fecha · severidad · descripción · dónde.
> Al arreglar uno, márcalo `[x]` con la fecha del fix.

## Abiertos

- [ ] **2026-07-26 · menor · recursos** — `RuntimeManager.runtimes` (chat) **no expulsa nunca**: `get(id)`
  crea un runtime para cualquier string y se llama también desde `detach`/`stop`/`set_model`, así que cada
  sesión vista mantiene su log completo en RAM de por vida. Preexistente; el multi-pestaña y las
  reconexiones lo multiplican. Evictar los que no tengan subscribers ni turno y ya estén persistidos.
  `server/src/chat/runtime.ts`. (El revisor lo consideró NO bloqueante para el deploy: un solo usuario.)
- [ ] **2026-07-26 · menor · UX** — El probe del terminal (sondeo tras 8 s sin eco, p. ej. al teclear una
  contraseña en `sudo`) provoca un `snapshot` y `TerminalPane` hace `reset()` + repintado completo del
  scrollback con salto al fondo. Es mucho mejor que la alternativa anterior (cortar el socket y perder las
  teclas), pero convendría que el probe use una trama que no dispare snapshot, o repintar por diff de
  sufijo. `client/src/views/Terminal/terminalStore.ts`, `TerminalPane.tsx`.
- [ ] **2026-07-26 · menor · recursos** — Los **trabajos en segundo plano de la shell** (`npm run dev &`)
  sobreviven al cierre de la pestaña y al `shutdown`: el SIGKILL va al `bash -l` y sus hijos quedan
  reparentados. Es la semántica estándar de una shell matada, no un fallo, pero en este VPS significa CPU
  comida sin que se vea. Requeriría gestión de process groups. `server/src/terminal/runtime.ts`.
- [ ] **2026-07-26 · menor · recursos** — Detectado un proceso **`[claude] <defunct>` (zombi) del 6 de
  julio** en el backend desplegado, con padre `node dist/index.js`. Ajeno al trabajo de esta sesión
  (versión antigua en producción), pero sugiere que el puente no siempre cosecha el hijo `claude`.
  Revisar al tocar `server/src/chat/bridge.ts`.
- [ ] **2026-07-26 · menor · robustez** — El recorte del ring buffer de terminal es UTF-8-safe pero **no
  ANSI-safe**: el snapshot puede empezar a mitad de una secuencia de escape (basura o atributo de color
  colgado en la primera línea). `server/src/terminal/runtime.ts`.
- [ ] **2026-07-26 · menor · push** — Si el socket muere **antes** de que el turno pase a `running`/
  `queued`, no se programa el aviso de "sigue trabajando" (el de "terminó" sí llega).
  `server/src/chat/runtime.ts`.

- [x] **2026-07-02 · menor · a11y** — (OBSOLETO 2026-07-03) `NavIsland` **eliminada** al migrar a
  drawer `☰` + barra inferior (ver decisiones.md). El bug del `aria-expanded` de la píldora ya no aplica.
- [x] **2026-07-02 · menor · a11y** — (RESUELTO POR RETIRADA 2026-07-03) La falta de focus-trap era de
  `NavIsland` (eliminada). El nuevo `NavDrawer` **sí** trae focus-trap, cierre con `Esc`, foco inicial y
  devolución de foco al cerrar. `client/src/components/NavDrawer/NavDrawer.tsx`.
- [ ] **2026-07-03 · menor · a11y** — El panel de historial del chat (`role="dialog"` `aria-modal`) no
  atrapa el foco ni lo devuelve al disparador al cerrar (Escape, ✕ y el backdrop sí cierran; foco inicial
  al panel OK). Mismo patrón pendiente que NavIsland. `client/src/views/Chat/ChatHistory.tsx`.
- [ ] **2026-07-02 · menor · seguridad** — `resolveSafe` (FS API) valida por ruta (`path.resolve` +
  `startsWith(FS_ROOT)`) pero **no resuelve symlinks**: un symlink DENTRO de `FS_ROOT` que apunte
  fuera podría escapar del root. Aceptable en v1 (un solo usuario sobre su propio FS, tras auth),
  pero endurecer con `fs.realpath` + recheck si algún día hay más superficie. `server/src/fs/paths.ts`.
- [ ] **2026-07-02 · menor · feature** — Falta el **estado git por archivo** en el explorer (DESIGN §8
  pide marca M/A/… a la derecha): la FS API v1 no expone git-status. Pendiente endpoint + columna.
  `server/src/fs/routes.ts`, `client/src/views/Files/FileTree.tsx`.
- [ ] **2026-07-02 · nota** — La fila de conexión de Files es estática (`● connected`), no refleja un
  polling real de salud. Decidir si se quiere indicador dinámico. `client/src/views/Files/FilesView.tsx`.
- [x] **2026-07-02 · menor · feature** — (FIX 2026-07-03) Al **recargar**, el hilo aparecía vacío y
  no reanudaba la sesión de Claude. Resuelto: se persiste el hilo (`thread` JSON) + el `claudeSessionId`
  en SQLite (endpoints `GET /sessions/:id`, `PATCH /sessions/:id` upsert), el cliente rehidrata al
  montar (lazy) y reanuda con `resume`. Ver decisiones.md "Chat: persistir el HILO + historial".
  `server/src/chat/store.ts`, `server/src/chat/routes.ts`, `client/src/views/Chat/chatStore.ts`.
- [ ] **2026-07-02 · menor · UX** — Editor: el **undo** se reinicia al cambiar de pestaña (se remonta
  CodeMirror con `key={path}`); el contenido no guardado SÍ se conserva. `client/src/views/Editor/CodeArea.tsx`.
- [x] **2026-07-02 · menor · feature** — (OBSOLETO 2026-07-03) `DELETE /api/chat/sessions/:id` sí está
  cableado: la × de la pestaña ahora **cierra** (no borra, `open:false`) y el **borrado real** vive en el
  panel de historial (`ChatHistory.tsx` → `deleteSession`). `client/src/views/Chat/`.
- [ ] **2026-07-02 · nota · seguridad** — El chat hereda `settingSources` por defecto: si el usuario
  define `permissions.allow` global en `~/.claude`, esas reglas pre-aprobarían tools también en PortaIDE.
  Aceptable (un solo usuario); aislar con `settingSources: []` si se quiere. `server/src/chat/bridge.ts`.
- [ ] **2026-07-02 · pendiente** — **Service worker / offline PWA** no implementado (manifest y
  head-snippet sí). Aplazado. `client/`.
- [~] **2026-07-03 · feature (PEDIDO POR EL USUARIO)** — Historial del chat con las **conversaciones reales
  del engine** (las de VS Code). **BACKEND HECHO 2026-07-06** (opción B + proyecto activo, ver decisiones.md):
  `server/src/chat/engineHistory.ts` (parser `.jsonl`→`LogEvent[]`) + `GET /api/chat/engine/sessions[?cwd]`
  y `.../:id`. Verificado (smoke sobre transcripts reales). **FALTA LA UI** (cablear el panel `ChatHistory`
  + acción "abrir del engine" en `chatStore`), BLOQUEADA por el punto siguiente (cliente sin migrar).
  `server/src/chat/engineHistory.ts`, `client/src/views/Chat/ChatHistory.tsx`, `chatStore.ts`.
- [x] **2026-07-06 · ALTO · chat roto en el working tree** — ✅ **RESUELTO 2026-07-06.** `chatStore.ts`
  **migrado al protocolo del SessionRuntime**: `attach`/`detach`/`message`/`stop`/`permission`/`set_model`/
  `set_permission_mode` (todos con `sessionId`); procesa `snapshot`/`event`/`status`; el hilo se ENSAMBLA
  desde el `LogEvent[]` autoritativo del server (reducer `reduceEvent`), attach a todas las pestañas abiertas
  (multi-sesión + re-attach al reconectar). Eliminados `user_message`/`loadThread`/`persistSession`/`hydrated`
  del cliente (el server es autoritativo del hilo). Verificado: typecheck+build (client) VERDES + **contrato
  cotejado** campo a campo con `ws.ts`/`runtime.ts` (0 `user_message` restantes). **Pendiente e2e:** probar
  en runtime tras deploy (bloqueado por WS-support en NPM + working tree con trabajo de otros terminales).
  `client/src/views/Chat/chatStore.ts`.
- [x] **2026-07-03 · menor · limpieza** ✅ RESUELTO 2026-07-06 — Tras retirar `NavIsland`, `ChatComposer`
  seguía escribiendo `setBottomInset(altura)` en `ShellLayoutProvider` pero ya nadie lo leía. Eliminados
  `client/src/layout/ShellLayoutProvider.tsx` (y el dir `layout/`), el `ResizeObserver` del composer y el
  wrapper en `App.tsx`. Typecheck + build verdes.
