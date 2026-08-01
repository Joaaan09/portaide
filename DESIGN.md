# PortaIDE — Sistema de Diseño

> Fuente de verdad de todo lo visual. **Cumplimiento obligatorio** (ver [CLAUDE.md](CLAUDE.md) §5).
> El **norte visual** son los dos mockups del repo: `PortaIDE Brand (offline).html` (marca) y
> **`Editor Movil (offline).html`** (la app: 5 vistas, 3 temas, todos los tokens ya resueltos).
> Si algo no está aquí: **decídelo, añádelo aquí primero**, luego implementa.

---

## 0. Restricciones negativas (el "nada de…")

- **Nada de colores literales** en componentes. Solo tokens `--*` (cambian con el tema).
- **Nada de tema claro** en v1: los 3 temas son oscuros. (La guía de marca muestra el icono sobre
  blanco, pero la **app** es oscura.)
- **Nada de sombras pesadas** para separar UI: se separa con **bordes de 1px `--border`**. Sombra
  pesada solo en elevación real (drawer/barra inferior de navegación, marco del teléfono).
- **Nada de gradientes decorativos** en el chrome. El único degradado permitido es el **glow radial
  de acento** (fondo) y algún fondo de "home screen" en la marca.
- **Nada de rejillas simétricas de cards** ni relleno tipo dashboard: esto es un IDE, es **denso,
  plano y de columna única** (móvil).
- **Nada de librería de componentes con estética propia** (p.ej. shadcn por defecto) que pelee con
  estos tokens. Construimos los componentes contra este sistema.

## 1. Principios

- **Mobile-first, una mano.** Todo pensado para vertical, pulgar y pantallas pequeñas. Los destinos
  se alcanzan con una mano: drawer `☰` (por defecto) o barra inferior (alternativa), elegibles en Settings (§5).
- **El código es el héroe.** Todo lo monoespaciado (código, terminal, rutas, diffs, labels técnicos)
  va en **JetBrains Mono**. La UI de alrededor es sobria para que el código destaque.
- **Terminal / violeta.** Identidad "prompt de terminal" en morado. El cursor que parpadea (`▮`) y
  el `❯` son motivos de marca.
- **Plano y denso, separado por líneas.** Superficies escalonadas (`--bg` < `--surface` < `--surface2`)
  y bordes de 1px. Jerarquía por tipografía y color de texto (`--text` / `--dim` / `--faint`).

## 2. Tipografía

- **UI**: `'IBM Plex Sans', system-ui, sans-serif`. Pesos 400/500/600/700.
- **Mono**: `'JetBrains Mono', monospace`. Código, terminal, rutas, git, versiones, tamaños, eyebrows.
- **Eyebrows / labels de sección**: mono o sans en mayúsculas, `letter-spacing` ~.6–1px, `--faint`.
- Tamaños de referencia del mockup (px): cuerpo de chat 13.5, código 13/línea 20, terminal 12/línea 18,
  labels 10–11, títulos de vista 16–19. Números tabulares donde haya cifras.

## 3. Color — tokens + los 3 temas

**Regla dura:** los componentes consumen **solo** estos tokens semánticos. Los valores viven en el
tema activo (se setean como variables CSS en la raíz de la app / marco).

### Tokens semánticos

| Token | Uso |
|---|---|
| `--bg` | fondo base (editor, terminal, inputs) |
| `--surface` | superficie 1 (cabeceras, cards, barras) |
| `--surface2` | superficie 2 (chips, filas activas, estados) |
| `--border` | bordes/divisores de 1px |
| `--text` | texto principal |
| `--dim` | texto secundario |
| `--faint` | texto terciario / números de línea / placeholders |
| `--accent` | acento de marca (violeta): activo, cursor, botones primarios, keyword |
| `--accent2` | acento secundario (bordes de foco fuerte, split) |
| `--glow` | glow radial de acento (fondo, sombras del drawer/barra de nav) |
| `--on-accent` | texto/glifos **encima** de `--accent` (botones Approve/Send, burbuja de usuario, segmented activo, knob del toggle, badge del proyecto) |
| `--green` `--red` `--yellow` `--blue` `--orange` | estados, git y **syntax highlighting** |

> Sobre acento: el texto **encima** de `--accent` nunca es blanco: usa `--on-accent` (oscuro,
> `#0b0712` en los 3 temas — valor del mockup). Excepción documentada: los **badges de icono de
> archivo** (colores fijos por extensión, no de acento) usan el literal `#0a0a0f` (ver abajo).

### Los 3 temas (valores exactos del mockup — copiar tal cual)

**Midnight** (`crt`, por defecto)
```
--bg #0a0a0f  --surface #111119  --surface2 #191926  --border #242433
--text #e8e8f2  --dim #9494ac  --faint #565670
--accent #a970ff  --accent2 #8b5cf6  --glow rgba(169,112,255,.28)  --on-accent #0b0712
--green #63e6a3  --red #ff7a90  --yellow #f0d070  --blue #74b6ff  --orange #ff9e64
```
**Lavender** (`slate`)
```
--bg #14141a  --surface #1d1d26  --surface2 #262632  --border #333342
--text #ececf3  --dim #a2a2b6  --faint #6a6a80
--accent #b6a0ff  --accent2 #9683f0  --glow rgba(182,160,255,.20)  --on-accent #0b0712
--green #7fe0ac  --red #ff8698  --yellow #efd587  --blue #8ec0ff  --orange #ffab77
```
**Magenta** (`indigo`)
```
--bg #09060f  --surface #150d21  --surface2 #1f1531  --border #2d2042
--text #f3ecff  --dim #b2a2cc  --faint #6c5c86
--accent #c264ff  --accent2 #9b3ff0  --glow rgba(194,100,255,.32)  --on-accent #0b0712
--green #66e6b0  --red #ff6f97  --yellow #f2cf7a  --blue #7fa8ff  --orange #ff8f6b
```

### Syntax highlighting (mapa token → color)

| Clase | Significado | Color |
|---|---|---|
| `kw` | keyword | `--accent` |
| `ty` | tipo | `--blue` |
| `st` | string | `--green` |
| `fn` | función | `--yellow` |
| `nm` | número / constante | `--orange` |
| `cm` | comentario | `--faint` |
| `pn` | puntuación | `--dim` |
| `tx` | identificador / texto | `--text` |

### Estado, git y tipos de archivo

- **Conexión / OK**: `--green` (punto `●` + "connected"). **Error/borrado**: `--red`.
- **Git en el explorer**: `M` → `--yellow`, `A` → `--green`, otro → `--blue`.
- **Badge de icono de archivo** (cuadradito con la extensión, texto oscuro `#0a0a0f` encima):
  `ts` #3178c6 · `json` #e5b95c · `env` #9484b8 · `dockerfile` #3a8fd9 · `md` #5a5a70. Carpetas: `--accent`.

### Diffs (Editor y tool-cards de Edit)

- Línea **añadida**: fondo `rgba(99,230,163,.09)`, signo/texto `--green`.
- Línea **eliminada**: fondo `rgba(255,122,144,.09)`, signo/texto `--red`.
- Contexto: fondo transparente, texto `--dim`, signo `--faint`.

## 4. Espaciado, radios, bordes, elevación, glow

- **Bordes**: 1px `--border` para todo divisor/card. Foco fuerte: 2px `--accent`/`--accent2`.
- **Radios**: inputs/cards 10–14px · chips/pills 7–20px · botones 8–11px · ítems de nav (drawer) 9–10px ·
  marco del teléfono 50px · badges de archivo 4–7px.
- **Elevación**: por defecto **ninguna** (líneas). Sombra real solo en: drawer/barra inferior de navegación
  (`0 16px 44px rgba(0,0,0,.6), 0 0 30px var(--glow)`) y marco del teléfono.
- **Glow de acento**: radial `var(--glow)` arriba-centro del viewport (`opacity` togglable en Settings).
  Es el único "efecto" ambiental; sutil, nunca sobre texto.

## 5. Shell móvil — marco, status bar y navegación

- **Marco**: columna única `100dvh`, `overflow:hidden`; el scroll vive en el `<main>` de cada vista
  (patrón app-shell, evita barras flotantes en PWA iOS). Fondo `--bg` con el glow por encima.
- **Status bar** (solo mockup/preview): hora, dynamic island, señal/batería. En la PWA real la pinta el SO.
- **Navegación = dos modos intercambiables** (elegibles en Settings → Appearance; preferencia `navMode`
  persistida, §13b). **App edge-to-edge**: el `.viewport` **no reserva banda inferior** por sí mismo; la
  holgura inferior de cada superficie se calcula con la var **`--nav-inset`** (`0` en modo drawer, alto de
  la barra en modo bottombar) + `env(safe-area-inset-bottom)`. La safe-area inferior la asume cada
  superficie de fondo (el composer del Chat rellena su propia safe-area; las listas scrollables reservan
  su holgura con `--nav-inset`).
  - **(a) Drawer con hamburguesa `☰` (por defecto)**: un botón `☰` en la **cabecera de cada vista** (primer
    elemento a la izquierda) abre un **panel lateral** que desliza desde la izquierda. Ancho `min(78vw, 300px)`,
    alto completo, superficie translúcida `color-mix(in srgb, var(--surface) 92%, transparent)` +
    `backdrop-filter: blur(...)`, borde derecho 1px `--border`, sombra de §4. Cabecera con wordmark "PortaIDE"
    pequeño; debajo, la **lista de los 5 destinos** (icono mono + label); el activo con borde/acento izquierdo,
    texto `--accent` y fondo sutil. Al tocar un destino: navega y cierra el drawer. Detrás, un **scrim**
    (`rgba(0,0,0,.30)` + `blur(2px)`) que cierra al tocar. Accesible: `role="dialog"`, `aria-modal`,
    focus-trap, cierre con `Esc`, foco inicial al abrir y devolución al cerrar. En este modo el `☰` aparece
    en las cabeceras y **no** hay barra inferior (`--nav-inset: 0`).
  - **(b) Barra inferior fija (alternativa)**: barra `position: fixed` al borde inferior real, alto
    `var(--bottombar-height)` (`56px`) + `padding-bottom: env(safe-area-inset-bottom)`, superficie translúcida
    + `backdrop-filter`, borde superior 1px `--border`, sombra superior sutil. **5 ítems** (icono arriba +
    label pequeño): el activo en `--accent` (indicador superior sutil opcional), el resto en `--dim`; tap →
    navega. Persistente (sin animación de entrada). En este modo el `☰` **se auto-oculta** de las cabeceras y
    `--nav-inset: var(--bottombar-height)` para que el contenido reserve su altura.
  - Iconos: Files `▤` · Editor `{ }` · Chat `✦` · Terminal `>_` · Settings `⚙`.
  - Animaciones: drawer slide-in lateral (~200–240ms `--ease-out-strong`) + scrim fade (~180ms); barra
    inferior sin animación de entrada (transición de color del ítem activo ~150ms). Ver §11 y §13b.
  - Nota: la superficie translúcida se tokeniza con `color-mix` sobre `--surface` para seguir al tema activo
    en los 3 temas. (**Divergencia intencionada del mockup** —que pinta una barra abajo-centro— hacia drawer
    `☰` + barra inferior intercambiables, a petición del usuario; ver decisiones.md, 2026-07-03.)

## 6. Vista Chat (Claude Code) — la estrella

Réplica de Claude Code en VS Code (ver [CLAUDE.md](CLAUDE.md) §4). Estructura:

- **Cabecera**: pestañas de chats (icono `✦`, activa con subrayado `--accent` y fondo `--surface2`) + `+` para nuevo chat + botón **historial** (`🕘`/reloj) que abre el panel de conversaciones (§6.2).
- **Hilo** (scroll): burbujas y bloques con `gap` generoso.
  - **Usuario**: alineado a la derecha, fondo `--accent`, texto `--on-accent`, radio `15px 15px 4px 15px`, máx ~82%.
  - **Asistente**: alineado a la izquierda, con cabecerita (`✦` en cuadradito + "Claude Code" en `--dim`).
    - **Thinking** colapsable: "Thought for a moment" en `--faint` cursiva; al abrir, bloque con
      borde-izquierdo `--border`.
    - **Tool-cards**:
      - **Read**: fila con `◉` en `--blue`, `Read <ruta>` en mono, meta ("142 lines") en `--faint`.
      - **Edit**: card con cabecera (`✎` acento, `Edit <archivo>`, `+N`/`−M` en green/red) + **diff**
        (§3) + **botones Approve (`--accent`) / Reject (`--surface2`)**; tras decidir, muestra estado
        ("✓ Applied", "✕ Rejected", "✓ Auto-applied").
      - **Bash**: card fondo `#000` con cabecera `$ comando` (verde) + salida mono (verde si PASS/✓).
    - Texto final del mensaje: **Markdown renderizado** (no texto plano), estilos por tokens (§6.1).
  - **Typing**: tres puntos `--accent` con animación `dot`.
- **Input** (anclado al borde inferior real): fila de chips de contexto (`@archivo`, `+ context`), caja
  `--bg` con borde, placeholder "Ask Claude to build, fix, refactor…", botón **↑** (acento cuando hay
  texto). El composer ocupa **todo el ancho** y se ancla al **borde inferior real** de la pantalla: su
  superficie rellena la safe-area inferior (el contenido queda por encima del home-indicator) y suma
  `--nav-inset`: en modo drawer llega al fondo real, en modo barra inferior reserva la altura de la barra
  para quedar por encima (§5/§13b). Debajo, el **pie de controles**:
  - **Resumen colapsado** (por defecto): fila-botón con un icono de ajustes (`--dim`) + resumen en mono
    `--faint` `modelo · permiso · esfuerzo` (p.ej. `Opus 4.8 · Ask · Auto`) + chevron. Un tap despliega
    el panel **hacia arriba** (el composer está anclado abajo); el chevron gira 180°. Mantiene el pie
    limpio a una mano. Persiste todo en `localStorage` (`portaide:chat:{model,permission,effort}`).
  - **Panel de controles** (expandido), tres filas etiquetadas en mono `--dim` (uppercase):
    - **Model**: `select` mono sin chrome nativo, valor = alias (`fable`/`opus`/`sonnet`/`haiku`, o "Por
      defecto" = `~/.claude`), etiqueta con versión (Fable 5, Opus 4.8, Sonnet 5, Haiku 4.5). Manda `set_model`.
    - **Permissions**: segmented full-width de 4 (Ask / Plan / Auto-edits / Bypass); activo en `--accent`
      sobre `--on-accent`. Manda `set_permission_mode` (Plan = planifica sin tocar nada; Bypass = `clauded`).
    - **Effort**: slider `range` de 6 topes (Auto · Low · Medium · High · xHigh · Max), track `--surface2`,
      thumb `--accent`, ≥44px de zona táctil, valor actual en mono `--accent`. Auto no envía nada (default
      del engine); los demás viajan como `effort` en el `user_message`. `aria-valuetext` con el nivel.
  - Motion (§11): el panel entra con fade+`translateY(4px)` (.18s ease); `prefers-reduced-motion` desactiva
    la animación, el giro del chevron y el rebote del thumb.

### 6.1. Markdown del texto del asistente

El texto final del mensaje del asistente llega en **Markdown** (lo emite el CLI `claude`) y se renderiza,
no se pinta plano. Implementación: `react-markdown` + `remark-gfm` (GFM: tablas, tachado, autolinks,
listas de tareas), **sin HTML crudo** (no `rehype-raw`: seguro por defecto) y **sin highlighting por
lenguaje** en v1 (decisión: peso en móvil; los bloques van monoespaciados sobre superficie, se puede
subir a highlighting después). Componente: `client/src/views/Chat/Markdown.tsx` (+ `Markdown.module.css`).

Reglas visuales (solo tokens `--*`):

- **Encabezados** `h1..h4` en `--text` con peso 600 y escala decreciente (19/17/15/13.5px); `h5/h6` en `--dim`.
- **Énfasis**: `strong` peso 600 `--text`, `em` cursiva, `del` (tachado GFM) en `--faint`.
- **Código inline**: JetBrains Mono, fondo `--surface2`, borde `--border`, radio 5px.
- **Bloque de código** (`pre`): JetBrains Mono sobre `--surface` con borde `--border`, radio 9px y
  **scroll horizontal propio** (nunca desborda la página); sin colorear la sintaxis en v1.
- **Listas**: viñeta/número con `::marker` en `--faint`; **listas de tareas** GFM sin viñeta y checkbox
  con `accent-color: var(--accent)`.
- **Cita** (`blockquote`): borde-izquierdo `--border`, texto `--dim`.
- **Enlaces**: `--accent` subrayado, **abren en pestaña nueva** con `rel="noopener noreferrer"`.
- **Tablas** GFM: borde `--border`, cabecera con fondo `--surface2`; **scroll horizontal propio** en móvil.
- **Regla horizontal** (`hr`): línea `--border`.
- El primer/último hijo no aporta margen exterior: el ritmo entre bloques lo marca el `gap` del contenedor.

### 6.2. Historial de conversaciones + persistencia del hilo

> **Fuente del historial (2026-07-06):** el panel lista las conversaciones **reales del engine** (Claude
> Code / VS Code) del proyecto abierto — no solo las creadas dentro de PortaIDE. Backend hecho
> (`GET /api/chat/engine/sessions[?cwd]` → id/`aiTitle`/fecha/rama; `.../:id` → transcript convertido a
> `LogEvent[]`, repintable + reanudable con `resume`). **La UI de esta sección está pendiente** de migrar
> el cliente del chat al protocolo `attach`/`snapshot` del SessionRuntime; su diseño visual (cómo se listan
> las del engine, badges de rama, etc.) se cierra aquí al cablearla.

El chat **persiste el hilo** de cada conversación (no solo el título): al recargar, el chat abierto se
**rehidrata** (mismas burbujas, thinking, tool-cards) y se puede **seguir escribiendo** (el contexto de
Claude se retoma con `resume` vía el `claudeSessionId` persistido). Modelo **pestañas ≠ historial**:

- **Pestañas** = conversaciones *abiertas ahora* (`open=1`), tira horizontal como hasta ahora, orden
  estable por antigüedad. La **`×` de una pestaña la CIERRA** (la saca de la tira), **no la borra**:
  sigue viva en el historial. La **pestaña activa se persiste** (localStorage) para no saltar de pestaña
  al recargar.
- **Historial** = *todas* las conversaciones (abiertas + cerradas). Se abre con el botón `🕘` de la
  cabecera (§6).

**Panel de historial** (overlay sobre el hilo, no pantalla completa; ancho del contenido de la app):

- Entra con **fade + `translateY`** desde la cabecera (coherente con el panel de controles del composer,
  §11); `prefers-reduced-motion` lo desactiva. Fondo `--surface` con borde `--border`, radios del sistema.
- **Cabecera del panel**: título "Conversaciones" (mono `--dim`, uppercase) + botón cerrar (`✕`, `--dim`).
- **Lista** scrollable; cada fila:
  - Título en IBM Plex Sans `--text`; si la conversación está **abierta**, punto `--accent` a la izquierda.
  - Meta en mono `--faint`: fecha relativa (`updatedAt`, p.ej. "hace 2 h").
  - **Tap en la fila** → abre/activa la conversación (si estaba cerrada, se reabre como pestaña) y cierra
    el panel.
  - Acciones por fila: **renombrar** (`✎`, edición inline del título → `PATCH title`) y **borrar**
    (`🗑`, con **confirmación**; es destructivo y definitivo → `DELETE`).
  - Objetivos táctiles cómodos (§12); fila ≥44px.
- **Vacío**: mensaje "Sin conversaciones todavía" en `--faint`.

Persistencia (contrato con el backend): el hilo se guarda como blob JSON (`thread`) por sesión; el cliente
hace `PATCH /api/chat/sessions/:id` con `{ thread, claudeSessionId }` al cerrar cada turno y al resolver
aprobaciones, `{ open }` al cerrar/reabrir pestaña y `{ title }` al renombrar. Rehidratación **lazy**: al
montar se cargan las pestañas abiertas (meta) y el hilo de la activa vía `GET /sessions/:id`; el resto se
piden al enfocarlas. Detalle técnico en `.progreso/decisiones.md`.

### 6.3. Tira de estado de conexión (componente compartido)

> Añadida 2026-07-26. En móvil el WebSocket del chat se queda **zombi en `OPEN`** (pantalla bloqueada,
> cambio WiFi↔datos) y el hilo deja de crecer: el turno sigue vivo en el server, pero el usuario ve un
> chat "parado" sin ninguna señal. La tira hace visible ese estado. Detalle técnico en `.progreso/decisiones.md`.

- **Es un componente compartido**, no un patrón copiado: vive en `client/src/components/ConnBanner/`
  (`ConnBanner.tsx` + `.module.css`) y lo consumen **Chat** (aquí) y **Terminal** (§9.1). Cualquier cambio
  de esta sección se hace **una sola vez**, ahí. Las diferencias entre vistas se cubren con **props
  opcionales** (texto de error ajeno al socket, handler y etiqueta de reintento), nunca con otro chasis.
- **Ubicación**: fila fina justo **debajo de la cabecera de pestañas** de la vista (§6/§9), ancho completo,
  empujando el contenido (no flota sobre él). **Solo existe cuando hay algo que decir**: con la conexión
  sana (y, en el Chat, las conversaciones cargadas) **no se renderiza nada** (altura 0, cero ruido).
- **Retardo de aparición ~800ms**: reconectar suele tardar ~200ms, así que un microcorte (o el arranque
  de la app) **no pinta nada**. La tira solo aparece si el problema persiste.
- **Chasis**: fondo `--surface2`, borde inferior 1px `--border`, alto ~34px, texto mono 11px `--dim`,
  punto de estado de 6px a la izquierda (patrón de §3 "Estado / OK").
- **Estados** (manda el socket: un fallo ajeno solo se anuncia si la conexión está sana):
  - **Reconectando** (socket abriéndose): punto `--yellow` con `connPulse`, texto `Reconectando…`. Informativo
    (`<p role="status">`), **nunca accionable** (el cliente ya está reintentando).
  - **Sin conexión** (socket caído, esperando el reintento): punto `--red`, texto `Sin conexión con el servidor`
    + acción `Reintentar`.
  - **Error de carga** (el socket va, pero falló algo ajeno a él): punto `--yellow`, texto que pasa la
    vista + acción `Reintentar`. Hoy solo lo usa el Chat: `No se pudieron cargar las conversaciones`.
- **Acción**: cuando hay reintento, **toda la tira es el botón** (target táctil de ancho completo, §12);
  la etiqueta `Reintentar` va a la derecha en `--accent`. `:active` baja a `--surface`; foco visible
  `outline: 2px --accent` hacia dentro. Sin handler de reintento la tira es informativa (`<p>`).
- **Motion** (§11): entra con fade + `translateY(-3px)` (.18s ease). El punto de "reconectando" usa
  `connPulse` (1.4s ease-in-out infinite, `opacity` .45↔1). `prefers-reduced-motion` desactiva ambas.
- **Accesibilidad**: `role="status"` + `aria-live="polite"` en una **región live permanente** (vive siempre
  en el DOM, aunque esté vacía, para que el cambio se anuncie de verdad) y sin robar el foco. Nunca es el
  único indicador: el hilo mantiene su typing y el composer su estado.

**Estado de entrega de la burbuja del usuario.** Mismo problema, otra cara: si el mensaje se envía por un
socket zombi, el `send` se pierde en silencio. La burbuja del usuario (§6) gana dos estados locales (el
hilo del server no los tiene):

- **Enviando** (aún sin confirmar por el server): burbuja a `opacity: .62` con transición .18s. Con red
  sana dura milisegundos; al confirmarse vuelve a opacidad plena **sin parpadeo** (misma identidad).
- **No entregado** (agotados los reintentos): burbuja atenuada + **pie a la derecha, bajo la burbuja**,
  en mono 10.5px: `⚠ No entregado` en `--red` + botón **`Reintentar`** (chip `--surface2`, borde
  `--border`, radio 7px, texto `--accent`). Nunca se finge que el mensaje llegó.

**Scroll del hilo.** El auto-scroll al fondo solo se aplica si el usuario **ya estaba al fondo**
(umbral 100px). Si está leyendo hacia arriba, su posición se respeta aunque entren mensajes o el hilo se
reconstruya al reconectar. Al cambiar de conversación siempre se baja al fondo.

## 7. Vista Editor

- **Tira de pestañas** de archivos (icono-badge de extensión + nombre; activa subrayada `--accent`;
  punto `--accent` si *modified*) + botón **split** (`◫`).
- **Breadcrumb** en mono `--faint` (`src › services › auth.service.ts`).
- **Área de código**: por línea → columna de marca de diff (`+`/`−`), número de línea (`--faint`,
  `user-select:none`), y tokens con *syntax highlighting* (§3). Fondo de línea tintado en diffs.
- **Split terminal** (opcional): panel inferior (~170px), borde superior 2px `--accent2`, mini-cabecera
  "✻ claude · split terminal", cursor que parpadea.
- **Barra de símbolos** (teclado móvil): fila scrollable de teclas mono (`{ } ( ) [ ] < > / \ | ; : = → ⌘ ⏎`),
  celdas ~42–46px, separadas por `--border`.

## 8. Vista Files

- **Cabecera**: badge del proyecto (cuadradito acento con inicial) + nombre + chip de rama (`⑂ main`).
  Debajo, fila de **estado de conexión** (`● ssh · host` verde + "connected").
- **Explorer**: label "EXPLORER" en `--faint`; filas de árbol con `chevron` (▾/▸) para carpetas,
  icono-badge para archivos, indentación por profundidad, marca git a la derecha (§3). Fila activa:
  fondo `--surface2` + borde-izquierdo 2px `--accent`.

## 9. Vista Terminal

- **Pestañas** (p.ej. `zsh`, `claude`, `dev server`) con punto de estado (verde OK, acento = claude) + `+`.
- **Salida**: mono, `line-height` 18, colores por tipo de línea (verde prompts/OK, rojo cambios/errores,
  `--text`/`--dim`/`--faint` según nivel). Prompt `❯` en `--green` con cursor `--accent` parpadeante.
- **Barra de teclas especiales**: `esc tab ctrl alt ~ / | - ^C ↑ ↓ ← →`, celdas mono ~46px.

### 9.1. Persistencia: estado de conexión y sesión terminada

> Añadido 2026-07-26. El pty vive en el server y **sobrevive** al socket (cambiar de vista, bloquear el
> móvil, recargar la PWA). Eso obliga a hacer visibles dos cosas que antes no existían: que el **socket**
> se ha caído (la terminal parece "parada" y no lo está) y que la **shell ha muerto** mientras no mirabas.
> Detalle técnico en `.progreso/decisiones.md`.

- **Marcador de estado de la pestaña** (sustituye al "punto de estado" genérico de arriba): punto de 7px
  `--green` con glow = conectada · punto `--faint` = conectando · punto `--red` = sin conexión ·
  **cuadrado** de 8px `--red` (`border-radius` 2px) = **la shell murió**. La forma, no sólo el color,
  distingue "muerta" de "sin conexión" (§12); se acompaña de texto sr-only.
- **Tira de conexión**: **es el componente compartido de §6.3, sin variantes** (mismo chasis, motion, copy,
  retardo y regla de "toda la tira es el botón"). Aquí se monta bajo la tira de pestañas, sin más props que
  el estado del socket y el reintento. Estados que la disparan en esta vista: **`Reconectando…`** (socket
  abriéndose, informativo) y **`Sin conexión con el servidor`** + `Reintentar` (socket caído esperando
  reintento). El **cwd no va en la tira**: el prompt de la shell ya dice dónde estás. Los **puntos de las
  pestañas** comparten la misma histéresis de 800ms que la tira (un microcorte no los hace parpadear).
  Un solo componente, dos vistas: cualquier cambio se hace en §6.3.
- **Aviso de sesión terminada**: barra anclada **abajo del área de terminal** (nunca un overlay: la
  salida final del proceso, que el snapshot acaba de repintar, tiene que seguir legible; el área de xterm
  reserva su alto, así que no tapa nada). Alto ≥44px, fondo `--surface`, borde superior 1px `--border`;
  cuadrado `--red` + texto mono 12px `--dim` `la shell terminó · código N` + acción **`Reiniciar shell`**
  (chip `--surface2` + 1px `--border`), que abre una shell nueva y limpia en esa pestaña. Entra con fade +
  `translateY(4px)` (.18s ease); reduced-motion: sólo fade.
- **`role="status"` + `aria-live="polite"`** en la tira (región live permanente, aunque esté vacía) y en el
  aviso: se anuncian sin robar el foco al área de escritura (el teclado móvil no se cierra).

## 10. Vista Settings

Secciones tipo "lista agrupada" (card `--surface`, filas separadas por 1px `--border`), con eyebrow
`--faint` mayúsculas.

> **Estructura real v1 (2026-07-02).** Se desvía del mockup canónico por la arquitectura decidida
> (v1 sin puente SSH; §2). Registrado aquí y en [.progreso/decisiones.md](.progreso/decisiones.md):
> - El panel **"VPS Connection" del mock NO se implementa**: describe SSH remoto (host/puerto/key), que
>   v1 no usa. Se sustituye por **"System"** con datos **reales** del backend local.
> - El grupo **"Claude Code"** (Model / Permission mode / Auto-approve) **se difiere**: en v1 esos
>   controles viven en el **composer del Chat** (cambio en caliente por WS), que es su fuente de verdad.
>   Duplicarlos en Settings crearía dos estados. Reevaluar si se quiere un "default persistente".

Grupos v1:

- **Account**: email de la sesión (mono `--dim`) + botón **Log out**.
- **Appearance**: **Theme** = 3 swatches (fondo del tema + puntito de acento; activo con borde de acento
  + glow), **Editor font size** = stepper `− 14px +` (mono, rango 11–20, aplica a CodeMirror en vivo).
- **System** (sustituye a VPS Connection): filas display en mono — Backend (uptime), Node, Claude CLI
  (versión), Workspace (`fsRoot`), Mongo (`Connected`/`Disconnected` en `--green`/`--red`).
- **Notifications** (§10.1): notificaciones Web Push del chat.
- Pie con marca/versión en mono `--faint` (hoy solo `PortaIDE`: el `package.json` es `0.0.0`; añadir
  versión cuando exista una real, sin acción "check updates" —no hay mecanismo de updates—).

### 10.1. Settings → Notificaciones (Web Push)

> Añadida 2026-07-26. No está en el mockup canónico (es funcionalidad nueva: avisar al móvil de que
> Claude sigue trabajando o ha terminado, con la app cerrada). La notificación **en sí** la pinta el
> sistema operativo: no se puede estilar, así que aquí solo se diseña el panel que la gobierna.
> Detalle técnico en [.progreso/decisiones.md](.progreso/decisiones.md).

Grupo "lista agrupada" (§10) con eyebrow `NOTIFICACIONES`. Filas de arriba abajo, del estado a la acción:

- **Estado** (fila display): label `--dim` + valor mono a la derecha, con color de refuerzo (§3):
  `Activadas` en `--green`, `Desactivadas` en `--dim`, `Permiso denegado` / `No disponible` en `--red`.
  El color nunca es el único indicador: el texto ya lo dice (§12).
- **Aviso de instalación** (solo si la PWA **no** está en standalone; iOS no entrega push en una pestaña
  de Safari): fila de texto explicativo 12.5px `--dim` con el gesto en mono `--text`
  (`Compartir › Añadir a pantalla de inicio`). Es un dato, no una alarma: sin fondo de error ni iconografía.
- **Acción principal**: botón de ancho completo, min-height 44px, radio 8px.
  - *Activar notificaciones* → **primario**: `--accent` / `--on-accent`, peso 600.
  - *Desactivar* → **secundario**: `--surface2`, borde 1px `--border`, texto `--dim`.
  - Ocupado: label en gerundio + `disabled` (`--surface2` / `--faint`, `cursor: default`).
  - Error: línea `role="alert"` en `--red`, 12.5px, sobria (mismo tono que §15).
- **Qué avisar**: dos filas con **switch** a la derecha; bajo el label, ayuda en mono 11px `--faint`.
  - `Terminó` — **activado por defecto**.
  - `Está trabajando` — **desactivado por defecto**, con la ayuda "en iOS suena y vibra".
  - Con las notificaciones desactivadas, ambas filas van atenuadas (`opacity: .5`) y sus switches `disabled`.
- **Prueba**: botón **secundario** "Enviar notificación de prueba" + línea de resultado en mono 11px
  (`--green` si salió, `--red` si falló), con `role="status"`.

**Switch (componente nuevo del sistema).** No existía; se define aquí para poder reutilizarlo:

- **Pista** 44×26px, radio 13px: apagada `--surface2` + borde 1px `--border`; encendida `--accent` +
  borde `--accent`.
- **Knob** 20px circular, desplazamiento 18px: apagado `--dim` (contraste sobre `--surface2`),
  encendido `--on-accent` (§3: nunca blanco sobre acento).
- **Semántica**: `<button role="switch" aria-checked>` con nombre accesible (`aria-labelledby` a la fila);
  `:focus-visible` outline 2px `--accent2`; área táctil ≥44px por padding (§12).
- **Motion** (§11): `transform` del knob + `background-color` de la pista, 160ms `ease`.
  `prefers-reduced-motion` desactiva ambas transiciones (cambio instantáneo).

## 11. Movimiento

Animaciones del mockup (respétalas; son la firma de interacción):

- `blink` — cursor de terminal/editor, `1s step-end infinite` (0→48% visible, 49→100% oculto).
- `fadein` — entrada de vista, `.18s ease` (opacity + `translateY(5px)`).
- `dot` — typing del chat, `1.2s infinite` con `.2s`/`.4s` de desfase entre los 3 puntos.
- **Drawer de navegación** (slide-in lateral, §5/§13b): `translateX(-100%)`→`0` en `~200–240ms` con
  `--ease-out-strong` (`cubic-bezier(.23,1,.32,1)`) + **scrim fade** `~180ms`. Reduced-motion: sin
  `transform`, solo fade (o instantáneo).
- **Barra inferior de navegación** (§5/§13b): persistente, **sin** animación de entrada; solo transición
  de color del ítem activo `~150ms`.
- `spin` — spinners (`to { transform: rotate(360deg) }`).
- `connPulse` — punto de la tira de estado de conexión (componente compartido, §6.3; lo usan Chat y
  Terminal §9.1), `1.4s ease-in-out infinite` (`opacity` .45↔1). No viene del mockup: se añade con la
  tira (2026-07-26).

Reglas: transiciones cortas (≤ ~220ms), `ease`/spring suaves, sin animar layout costoso. Respeta
`prefers-reduced-motion: reduce` (desactiva blink/rebotes; deja fades mínimos). Usa la skill
`review-animations` como rúbrica.

## 12. Accesibilidad y semántica (obligatorio)

- HTML **semántico** (`<nav>`, `<main>`, `<button>`, listas para árbol/hilo); no `div` para todo.
- Todo lo interactivo: navegable por teclado, `:focus-visible` claro (usa `--accent`/`--accent2`),
  objetivos táctiles cómodos (~44px).
- Contraste suficiente `--text`/`--dim` sobre `--bg`/`--surface`. `--faint` solo para texto no esencial.
- Inputs con label accesible; el cursor parpadeante nunca es el único indicador de foco.
- `-webkit-tap-highlight-color: transparent` + estados propios de `:active`.

## 13. PWA / Añadir a pantalla de inicio

- Instalable (`manifest.webmanifest` ya en `brand/`): standalone, vertical, `theme_color`/`background_color`
  `#0a0810`. Iconos en `brand/` (192/512/1024 maskable, apple-touch, favicons).
- Pega `brand/head-snippet.html` en el `<head>`. Marco app-shell (§5) para evitar barras flotantes en iOS.
- **Viewport**: `viewport-fit=cover` + `maximum-scale=1, user-scalable=no` para dar sensación de app y
  evitar el auto-zoom de iOS al enfocar inputs (<16px). El `<main>` de cada vista reserva
  `env(safe-area-inset-top)` (notch) y cada superficie inferior el `-bottom` (vía `--nav-inset`, §13b).
- **Anclaje del marco (teclado móvil)**: el shell (`.shell`) es **`position: fixed; inset: 0`** (no `100dvh`
  en flujo). Motivo: al abrir/cerrar el teclado del móvil el marco **no debe reacomodarse** ni dejar un
  hueco/espaciado residual abajo; anclado al viewport, el teclado solo se superpone y al cerrarse todo queda
  en su sitio, con la **barra inferior de nav siempre pegada al borde real**. El scroll vive dentro de cada
  vista; el pull-to-refresh (píldora fixed) y la nav (drawer/barra, fixed) son hermanos del shell. Además el
  **documento va bloqueado** (`html, body, #root { height: 100%; overflow: hidden }` + `overscroll-behavior:
  none` en `body`) para que iOS no pueda desplazar la página y dejar un hueco: la app nunca scrollea el
  documento, solo el `<main>`/lista de cada vista.
- **Pull-to-refresh**: en standalone, tirar hacia abajo cuando el scroll de la vista activa está arriba
  del todo recarga la app (indicador sobrio con `spin`). No se activa en pestaña de navegador (ya trae el
  nativo). Solo alrededor del shell; el drawer y la barra inferior de nav quedan fuera del gesto.

## 13b. Navegación — modos drawer/barra inferior (§5)

- **Preferencia `navMode`** (persistida en `localStorage: portaide:navMode`, default `drawer`; lee con
  fallback seguro si el valor está vacío o es inválido). La cambia el usuario en Settings → Appearance.
  - `drawer` (por defecto): botón `☰` en la cabecera de cada vista → panel lateral que desliza desde la
    izquierda sobre un scrim que cierra al tocar (o con `Esc`). Sin barra inferior. `--nav-inset: 0`.
  - `bottombar`: barra fija al borde inferior con los 5 destinos. El `☰` se auto-oculta de las cabeceras.
    `--nav-inset: var(--bottombar-height)`.
- **Modelo de clearance con `--nav-inset`**: `NavModeProvider` aplica la var en `document.documentElement`
  (`0px` en drawer, `var(--bottombar-height)` en bottombar). Cada superficie inferior reserva su holgura
  con `calc(var(--nav-inset, 0px) + env(safe-area-inset-bottom))`: en drawer el contenido llega al fondo
  real (solo safe-area), en bottombar reserva además la altura de la barra. El composer del Chat suma
  `--nav-inset` a su padding inferior para quedar siempre por encima de la barra.
- **Drawer accesible**: `role="dialog"`, `aria-modal`, focus-trap, cierre con `Esc`, foco inicial al abrir
  y devolución de foco al cerrar; el ítem activo lleva `aria-current`. Slide-in `--ease-out-strong` +
  scrim fade; reduced-motion sin `transform`.
- Tokens: `--bottombar-height` (alto de la barra, global), `--nav-inset` (holgura inferior según modo),
  `--ease-out-strong`.

## 13c. Chat — control de esfuerzo con "Ultracode" (§6)

- El slider de esfuerzo del composer añade un tope superior **"Ultracode"** (tras Max). No es un nivel de
  effort: activa los **workflows multiagente** del SDK (`options.settings.enableWorkflows`) y manda
  `effort: 'max'`. Lleva un aviso mono `--faint` de que consume más. Persiste como el resto de controles.

## 14. Checklist final de UI (repásalo antes de cerrar un PR de UI)

- [ ] Cero colores literales: todo vía tokens `--*`; funciona en los **3 temas**.
- [ ] Tipografía correcta: UI en IBM Plex Sans, todo lo técnico/código en JetBrains Mono.
- [ ] Separación por bordes de 1px, no por sombras; densidad de IDE, columna única.
- [ ] Motion según §11 + `prefers-reduced-motion`.
- [ ] Semántica + teclado + foco visible + contraste + táctil ~44px.
- [ ] Coincide con el mockup `Editor Movil (offline).html` (la vista que toques).

## 15. Vista Login (pre-autenticación)

> No está en el mockup canónico (el mockup asume sesión ya iniciada). Se documenta
> aquí antes de implementar (CLAUDE.md §5). Es la puerta del borde de seguridad
> (§11 de CLAUDE.md): sin sesión válida, es lo único que se renderiza.

- **Marco**: pantalla completa sobre `--bg` con el **glow radial de acento** (mismo patrón que
  el AppShell, §4), columna única centrada vertical y horizontalmente, con `padding` y safe-areas.
- **Card**: superficie `--surface`, borde 1px `--border`, radio 14px, ancho máx ~360px. Sin sombra
  pesada (§0): separa por borde. Dentro, en columna: marca → formulario.
- **Marca**: icono `/portaide-icon.svg` (~44px, radio) + wordmark **"PortaIDE"** (IBM Plex Sans 700,
  `--text`) + tagline corta en `--dim`. Alternativa de motivo: el `❯` de marca en `--green`.
- **Inputs** (email + contraseña): caja `--bg`, borde 1px `--border`, radio 10px, texto en
  **JetBrains Mono** (encaja con la estética terminal y con "el código es el héroe", §1/§2),
  min-height 44px (táctil, §12). **Label accesible** por input (mono, `--faint`, mayúsculas,
  `letter-spacing`), nunca solo `placeholder`. Foco: borde a `--accent` (`:focus-within`) — el
  indicador de foco no depende solo del cursor (§12).
- **Botón primario "Sign in"**: fondo `--accent`, texto `--on-accent`, radio 10px, ancho completo,
  min-height 44px, peso 600. Deshabilitado (sin datos o cargando) → `--surface2` / `--faint`.
  `:active` scale sutil, `:focus-visible` outline `--accent2` (§12).
- **Estado de error**: mensaje en `--red` (rol `alert`), texto sobrio, sin iconografía pesada.
  Mismo mensaje para email o contraseña incorrectos (no se filtra cuál; el backend devuelve
  `invalid_credentials`).
- **Estado de carga**: el botón muestra un spinner (animación `spin`, §11) + label "Signing in…";
  inputs y botón deshabilitados durante la petición.
- **Splash de arranque** (mientras se resuelve `GET /api/auth/me`): pantalla sobria sobre `--bg`
  con el glow + spinner de acento (anim `spin`). Sin contenido de app hasta conocer la sesión.
- **Motion**: entrada con `fadein` (§11); respeta `prefers-reduced-motion` (sin rebotes; el spinner
  se reduce a estado textual "Signing in…" / spinner sin giro). Todo con tokens, cero literales.

### Ajustes → Account (sección real dentro de Settings)

Primera sección funcional de Settings (el resto sigue como stub, §10). Sigue el patrón de
"lista agrupada" de §10:

- **Eyebrow** "ACCOUNT" en `--faint` mayúsculas + card `--surface` con filas separadas por 1px `--border`.
- Fila **"Signed in as"** (label `--dim`) + email de la sesión en **JetBrains Mono** `--text`.
- Botón **"Log out"**: botón **secundario** (fondo `--surface2`, borde 1px `--border`, texto `--red`
  para señalar que cierra la sesión), radio 8px, min-height 44px, `:focus-visible` outline `--accent2`.
  Llama a `useAuth().logout()`.
