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
  pesada solo en elevación real (isla de navegación, marco del teléfono).
- **Nada de gradientes decorativos** en el chrome. El único degradado permitido es el **glow radial
  de acento** (fondo) y algún fondo de "home screen" en la marca.
- **Nada de rejillas simétricas de cards** ni relleno tipo dashboard: esto es un IDE, es **denso,
  plano y de columna única** (móvil).
- **Nada de librería de componentes con estética propia** (p.ej. shadcn por defecto) que pelee con
  estos tokens. Construimos los componentes contra este sistema.

## 1. Principios

- **Mobile-first, una mano.** Todo pensado para vertical, pulgar y pantallas pequeñas. Los destinos
  se alcanzan desde abajo (isla dinámica), no desde una barra superior.
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
| `--glow` | glow radial de acento (fondo, sombras de la isla) |
| `--green` `--red` `--yellow` `--blue` `--orange` | estados, git y **syntax highlighting** |

> Sobre acento: el texto **encima** de `--accent` es oscuro (`#0b0712` / `#0a0a0f`), no blanco
> (botones Approve/Send, burbuja de usuario, badges de icono de archivo).

### Los 3 temas (valores exactos del mockup — copiar tal cual)

**Midnight** (`crt`, por defecto)
```
--bg #0a0a0f  --surface #111119  --surface2 #191926  --border #242433
--text #e8e8f2  --dim #9494ac  --faint #565670
--accent #a970ff  --accent2 #8b5cf6  --glow rgba(169,112,255,.28)
--green #63e6a3  --red #ff7a90  --yellow #f0d070  --blue #74b6ff  --orange #ff9e64
```
**Lavender** (`slate`)
```
--bg #14141a  --surface #1d1d26  --surface2 #262632  --border #333342
--text #ececf3  --dim #a2a2b6  --faint #6a6a80
--accent #b6a0ff  --accent2 #9683f0  --glow rgba(182,160,255,.20)
--green #7fe0ac  --red #ff8698  --yellow #efd587  --blue #8ec0ff  --orange #ffab77
```
**Magenta** (`indigo`)
```
--bg #09060f  --surface #150d21  --surface2 #1f1531  --border #2d2042
--text #f3ecff  --dim #b2a2cc  --faint #6c5c86
--accent #c264ff  --accent2 #9b3ff0  --glow rgba(194,100,255,.32)
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
- **Radios**: inputs/cards 10–14px · chips/pills 7–20px · botones 8–11px · isla de nav 24–28px ·
  marco del teléfono 50px · badges de archivo 4–7px.
- **Elevación**: por defecto **ninguna** (líneas). Sombra real solo en: isla de navegación
  (`0 16px 44px rgba(0,0,0,.6), 0 0 30px var(--glow)`) y marco del teléfono.
- **Glow de acento**: radial `var(--glow)` arriba-centro del viewport (`opacity` togglable en Settings).
  Es el único "efecto" ambiental; sutil, nunca sobre texto.

## 5. Shell móvil — marco, status bar y navegación

- **Marco**: columna única `100dvh`, `overflow:hidden`; el scroll vive en el `<main>` de cada vista
  (patrón app-shell, evita barras flotantes en PWA iOS). Fondo `--bg` con el glow por encima.
- **Status bar** (solo mockup/preview): hora, dynamic island, señal/batería. En la PWA real la pinta el SO.
- **Navegación = "isla dinámica" flotante** abajo-centro, `position: fixed`, `pointer-events` solo en
  la píldora:
  - **Cerrada**: píldora translúcida (`backdrop-filter: blur`) = icono de acento de la vista activa +
    su label + "hamburguesa" de 2 líneas. Un tap la **expande**.
  - **Abierta**: fila con las **5 pestañas** (icono mono + label), la activa con fondo `--surface2` y
    glow; detrás, un **scrim** oscuro con blur que cierra al tocar.
  - Iconos: Files `▤` · Editor `{ }` · Chat `✦` · Terminal `>_` · Settings `⚙`.
  - Animaciones: `islandOpen` (.22s `cubic-bezier(.2,.9,.3,1.2)`) y `islandScrim` (.18s). Ver §11.

## 6. Vista Chat (Claude Code) — la estrella

Réplica de Claude Code en VS Code (ver [CLAUDE.md](CLAUDE.md) §4). Estructura:

- **Cabecera**: pestañas de chats (icono `✦`, activa con subrayado `--accent` y fondo `--surface2`) + `+` para nuevo chat.
- **Hilo** (scroll): burbujas y bloques con `gap` generoso.
  - **Usuario**: alineado a la derecha, fondo `--accent`, texto `#0b0712`, radio `15px 15px 4px 15px`, máx ~82%.
  - **Asistente**: alineado a la izquierda, con cabecerita (`✦` en cuadradito + "Claude Code" en `--dim`).
    - **Thinking** colapsable: "Thought for a moment" en `--faint` cursiva; al abrir, bloque con
      borde-izquierdo `--border`.
    - **Tool-cards**:
      - **Read**: fila con `◉` en `--blue`, `Read <ruta>` en mono, meta ("142 lines") en `--faint`.
      - **Edit**: card con cabecera (`✎` acento, `Edit <archivo>`, `+N`/`−M` en green/red) + **diff**
        (§3) + **botones Approve (`--accent`) / Reject (`--surface2`)**; tras decidir, muestra estado
        ("✓ Applied", "✕ Rejected", "✓ Auto-applied").
      - **Bash**: card fondo `#000` con cabecera `$ comando` (verde) + salida mono (verde si PASS/✓).
    - Texto final del mensaje en `--text`.
  - **Typing**: tres puntos `--accent` con animación `dot`.
- **Input** (fijo abajo): fila de chips de contexto (`@archivo`, `+ context`), caja `--bg` con borde,
  placeholder "Ask Claude to build, fix, refactor…", botón **↑** (acento cuando hay texto). Debajo:
  **modelo** (mono, `--faint`, p.ej. `claude-sonnet-4.5`) + **permission label** ("Ask before edits" / etc.).

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

## 10. Vista Settings

Secciones tipo "lista agrupada" (card `--surface`, filas separadas por 1px `--border`), con eyebrow
`--faint` mayúsculas:

- **VPS Connection**: Host, User·Port, SSH Key (✓), Status (`● Connected · uptime` en `--green`).
- **Claude Code**: Model (mono `--accent`), **Permission mode** = segmented `Ask / Plan / Auto` (activo
  `--accent` texto oscuro), **Auto-approve edits** = toggle (track `--accent` cuando ON, knob `#0b0712`).
- **Appearance**: **Theme** = 3 swatches (fondo del tema + puntito de acento; activo con borde de acento
  + glow), **Editor font size** = stepper `− 14px +` (mono). Pie con versión en mono `--faint`.

## 11. Movimiento

Animaciones del mockup (respétalas; son la firma de interacción):

- `blink` — cursor de terminal/editor, `1s step-end infinite` (0→48% visible, 49→100% oculto).
- `fadein` — entrada de vista, `.18s ease` (opacity + `translateY(5px)`).
- `dot` — typing del chat, `1.2s infinite` con `.2s`/`.4s` de desfase entre los 3 puntos.
- `islandOpen` — apertura de la isla de nav, `.22s cubic-bezier(.2,.9,.3,1.2)` (rebote sutil).
- `islandScrim` — fade del scrim, `.18s ease`.
- `spin` — spinners (`to { transform: rotate(360deg) }`).

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

## 14. Checklist final de UI (repásalo antes de cerrar un PR de UI)

- [ ] Cero colores literales: todo vía tokens `--*`; funciona en los **3 temas**.
- [ ] Tipografía correcta: UI en IBM Plex Sans, todo lo técnico/código en JetBrains Mono.
- [ ] Separación por bordes de 1px, no por sombras; densidad de IDE, columna única.
- [ ] Motion según §11 + `prefers-reduced-motion`.
- [ ] Semántica + teclado + foco visible + contraste + táctil ~44px.
- [ ] Coincide con el mockup `Editor Movil (offline).html` (la vista que toques).
