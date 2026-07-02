# Bugs — pendientes conocidos

> Bugs detectados que NO se arreglaron en el momento. Formato: fecha · severidad · descripción · dónde.
> Al arreglar uno, márcalo `[x]` con la fecha del fix.

## Abiertos

- [ ] **2026-07-02 · menor · a11y** — En `NavIsland`, el `aria-expanded` de la píldora nunca se
  anuncia como `true`: la píldora se desmonta al abrir la isla (estructura calcada del mockup), así
  que el lector de pantalla no oye el cambio de estado en el propio trigger. Mitigado moviendo el
  foco al menú al abrir. Fix ortodoxo: trigger persistente que se transforma, en vez de desmontarse.
  `client/src/components/NavIsland/NavIsland.tsx`.
- [ ] **2026-07-02 · menor · a11y** — La isla abierta no tiene focus-trap: con Tab se puede salir
  del menú sin cerrarlo (Escape y el scrim sí cierran). Valorar trap ligero o cierre en `blur`.
  `client/src/components/NavIsland/NavIsland.tsx`.
- [ ] **2026-07-02 · menor · seguridad** — `resolveSafe` (FS API) valida por ruta (`path.resolve` +
  `startsWith(FS_ROOT)`) pero **no resuelve symlinks**: un symlink DENTRO de `FS_ROOT` que apunte
  fuera podría escapar del root. Aceptable en v1 (un solo usuario sobre su propio FS, tras auth),
  pero endurecer con `fs.realpath` + recheck si algún día hay más superficie. `server/src/fs/paths.ts`.
- [ ] **2026-07-02 · menor · feature** — Falta el **estado git por archivo** en el explorer (DESIGN §8
  pide marca M/A/… a la derecha): la FS API v1 no expone git-status. Pendiente endpoint + columna.
  `server/src/fs/routes.ts`, `client/src/views/Files/FileTree.tsx`.
- [ ] **2026-07-02 · nota** — La fila de conexión de Files es estática (`● connected`), no refleja un
  polling real de salud. Decidir si se quiere indicador dinámico. `client/src/views/Files/FilesView.tsx`.
- [ ] **2026-07-02 · menor · feature** — Al **recargar**, las pestañas de chat persisten (Mongo) pero
  el hilo aparece vacío y **no reanuda** la sesión de Claude: no se guarda/actualiza el `claudeSessionId`
  de cada pestaña (no hay endpoint de update). La conversación viva (sin recargar) sí funciona.
  `server/src/chat/store.ts`, `server/src/chat/routes.ts`, `client/src/views/Chat/chatStore.ts`.
- [ ] **2026-07-02 · menor · UX** — Editor: el **undo** se reinicia al cambiar de pestaña (se remonta
  CodeMirror con `key={path}`); el contenido no guardado SÍ se conserva. `client/src/views/Editor/CodeArea.tsx`.
- [ ] **2026-07-02 · menor · feature** — `DELETE /api/chat/sessions/:id` existe pero **no está cableado**
  en la UI (no hay botón de cerrar pestaña de chat). `client/src/views/Chat/`.
- [ ] **2026-07-02 · nota · seguridad** — El chat hereda `settingSources` por defecto: si el usuario
  define `permissions.allow` global en `~/.claude`, esas reglas pre-aprobarían tools también en PortaIDE.
  Aceptable (un solo usuario); aislar con `settingSources: []` si se quiere. `server/src/chat/bridge.ts`.
- [ ] **2026-07-02 · pendiente** — **Service worker / offline PWA** no implementado (manifest y
  head-snippet sí). Aplazado. `client/`.
