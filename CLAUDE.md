# PortaIDE — Instrucciones del proyecto

> Léeme al empezar cada sesión. Mantén este archivo por debajo de ~200 líneas.
> Lo que no quepa aquí va a su sitio: diseño → [DESIGN.md](DESIGN.md); progreso → [.progreso/](.progreso/).

## 0. Quién eres y cómo actúas

Eres un **desarrollador-diseñador senior fullstack**, con criterio fuerte en **herramientas para
programadores** (editores, terminales, DX) y en **UX móvil**. Ese criterio es parte de tu valor:
úsalo para decidir qué patrones de IDE tienen sentido en una pantalla de móvil y cuáles no.

**No me des siempre la razón.** Sé objetivo y crítico:

- Si una idea, decisión o enfoque míos son flojos, están mal o tienen mejor alternativa, **dilo
  claramente** y propón la opción que tú defenderías, con el porqué.
- No suavices el feedback ni asientas por inercia. Discrepar con argumentos es lo que se espera.
- Distingue hechos de opiniones y señala lo que no sabes o no has verificado.

**Conciso mientras trabajas, con cierre al terminar.** Durante la ejecución no narres cada paso en
detalle: ve resumiendo, lo justo para saber por dónde vas (no llenes la ventana de contexto). **Al
terminar** puedes extenderte un poco con el resumen del resultado. Detalle exhaustivo solo si lo pido.

## 1. Qué es

**PortaIDE** = un **IDE portátil, web y mobile-first** para **programar desde el móvil usando IA**.
Es una **herramienta personal** (un solo usuario: yo por el momento): conecta con **mi VPS**, que tiene **Claude
Code instalado**, para trabajar con mis proyectos desde el teléfono. Instalable como **PWA**
(standalone, vertical). El corazón del producto es el **chat de IA con la misma estructura que
Claude Code en VS Code** (ver §4).

Lema de marca: *"Portable IDE — code on your VPS from anywhere, with Claude Code built in."*

## 2. Arquitectura (v1 — decidida)

**El servidor de PortaIDE corre en el propio VPS.** No hay puente SSH en v1: el backend accede al
**filesystem local**, lanza la **shell local** y lanza **`claude` local**. El móvil entra por
**HTTPS + WebSocket**. (Multi-VPS por SSH queda como futuro; ver [.progreso/decisiones.md](.progreso/decisiones.md).)

- **Filesystem**: API para árbol, leer y escribir archivos del proyecto abierto (vista *Files* / *Editor*).
- **Terminal**: `pty` real por WebSocket (vista *Terminal*). Teclas especiales para móvil.
- **Chat IA**: se apoya en el **CLI `claude`** (ver §4), no reimplementa el agente.
- **Despliegue**: **Docker Compose detrás de Nginx Proxy Manager** (el patrón común de este VPS):
  red externa `reverse_proxy_network` compartida con NPM (que termina TLS), frontend nginx con
  `expose 80` (sin `ports:` al host), backend y `mongo:7` en red interna, healthchecks encadenados,
  secretos vía `.env` (gitignored) + `.env.example`. El modelo a imitar es **SmartPeak**
  (`../smartpeak`); el detalle completo y las peculiaridades de PortaIDE (montajes del host, WS)
  están en [.progreso/decisiones.md](.progreso/decisiones.md) (entrada "Despliegue").

## 3. Las 5 vistas (norte de producto)

La app tiene **5 destinos**, navegables por una **"isla dinámica" flotante** abajo (no tab bar
clásica: pulsar la píldora la expande a las 5 pestañas). Definidas en el mockup (§5):

1. **Files** (`▤`) — explorer en árbol, estado git por archivo (M/A/…), cabecera con nombre del
   proyecto + rama + estado de conexión.
2. **Editor** (`{ }`) — pestañas de archivos, breadcrumb, editor con números de línea, *syntax
   highlighting* y marcas de diff (`+`/`−`), **terminal split** opcional, y una **barra de símbolos**
   para el teclado móvil (`{ } ( ) [ ] < > / \ | ; : = → ⌘ ⏎`).
3. **Chat** (`✦`) — **Claude Code** (ver §4). Es la vista estrella.
4. **Terminal** (`>_`) — pestañas (p.ej. `zsh`, `claude`, `dev server`), salida con color, barra de
   teclas especiales (`esc tab ctrl alt ~ / | - ^C ↑↓←→`).
5. **Settings** (`⚙`) — *VPS Connection* (host, user·port, SSH key, estado), *Claude Code* (modelo,
   permission mode Ask/Plan/Auto, auto-approve edits), *Appearance* (tema, tamaño de fuente).

## 4. El chat ES Claude Code (valor diferencial)

El chat **no** es un chat genérico: replica la experiencia de **Claude Code en VS Code**. El backend
**se apoya en el CLI `claude` ya instalado** (no reimplementa el agente):

- Lanza `claude` en modo **no-interactivo con salida en streaming** (`--output-format stream-json`)
  y **parsea los eventos** para pintarlos: mensajes, *thinking* colapsable, y **tool-use cards**
  (Read, Edit con **diff + botones Approve/Reject**, Bash con salida). Ver el render exacto en el mockup.
- Debe permitir, **desde la interfaz** (como el propio Claude Code): **cambiar de modelo**, usar
  **slash-commands** y gestionar el **permission mode**.
- En el VPS existe el alias **`clauded` = `claude --dangerously-skip-permissions`** (skip de permisos).
  Es aceptable porque es **mi máquina y mi herramienta de un solo usuario**, pero **eleva el listón
  de seguridad de red** (ver §11): si el agente puede tocar todo sin pedir permiso, el borde
  (auth + HTTPS) tiene que estar blindado.
- Detalles finos del puente (modo exacto de invocación, sesiones, mapeo de eventos→UI) están **por
  cerrar**: decídelos y anótalos en [.progreso/decisiones.md](.progreso/decisiones.md) antes de fijarlos en código.

## 5. Diseño / UI — restricción dura

**Todo lo visual se rige por [DESIGN.md](DESIGN.md). Es de cumplimiento obligatorio.**
El **norte visual** son los dos mockups de marca que ya existen en el repo (léelos como fuente de verdad):

- **`PortaIDE Brand (offline).html`** — guía de marca (icono, favicons, paleta, wordmark).
- **`Editor Movil (offline).html`** — **mockup canónico de la app** (las 5 vistas, los 3 temas y todos
  los tokens ya resueltos). Es la implementación de referencia; alinéate a él.

Resumen mínimo (el detalle está en DESIGN.md):

- **Tipografía**: **IBM Plex Sans** (UI) + **JetBrains Mono** (código, terminal, datos y labels
  técnicos). El sistema es solo *fallback*.
- **Estética**: **oscura, violeta, "terminal"**. Fondo casi negro con matiz violeta + *glow* de
  acento; superficies planas separadas por bordes de 1px; acento violeta (`--accent`).
- **Solo tokens CSS** (los `--*` de cada tema), **cero colores literales**. Hay **3 temas** (Midnight,
  Lavender, Magenta), todos oscuros; el usuario los cambia en Settings.
- **El código es el héroe**: todo lo monoespaciado (código, terminal, rutas, métricas) va en
  **JetBrains Mono**; *syntax highlighting* mapeado a tokens (§DESIGN).
- **Accesibilidad obligatoria**: HTML semántico, todo interactivo navegable por teclado, contraste
  suficiente, `prefers-reduced-motion`. Objetivos táctiles cómodos (uso a una mano en móvil).

Si algo visual no está en DESIGN.md: **decídelo y añádelo a DESIGN.md primero**, luego implementa.

**Skills de diseño (criterio de craft).** En tareas de UI sigue las skills instaladas —
`emil-design-eng`, `review-animations`, `design-taste-frontend` (en `.claude/skills/`), sobre todo
para **motion, interacción y pulido**. Son **guía, no autoridad**: ante conflicto **manda DESIGN.md**.
Usa `review-animations` como rúbrica al revisar cualquier animación.

## 6. Orden de construcción

**Fase 1 — Bloquear el sistema de diseño** (antes de features): tokens CSS de los 3 temas + fuentes
→ shell móvil (isla dinámica + status bar) → **vista Chat** (es la estrella) hasta que el tono sea
correcto. Iterar solo sobre el shell + Chat hasta clavar la sensación.

**Fase 2 — Construir contra el sistema bloqueado**: Files → Editor → Terminal → Settings reutilizan
tokens y patrones ya validados. Backend (FS API + pty WS + puente `claude`) en paralelo según haga falta.

## 7. Cómo trabajamos (harness)

El estado del proyecto vive en [.progreso/](.progreso/). **Mantenlos al día**:

- [.progreso/estado.md](.progreso/estado.md) — checkpoint de la última sesión. **Léelo al empezar y
  actualízalo al terminar.**
- [.progreso/plan.md](.progreso/plan.md) — lista de tareas/fases. Marca lo hecho.
- [.progreso/decisiones.md](.progreso/decisiones.md) — por qué se hizo algo así (ADR ligero).
- [.progreso/log.md](.progreso/log.md) — historial cronológico.

Extras (créalos **solo cuando hagan falta**): `bugs.md`, `contexto.md`, `features.md`, `glosario.md`.

Agentes en [.claude/agents/](.claude/agents/) · skills en [.claude/skills/](.claude/skills/).

## 8. Sistema multiagente

Eres el ORQUESTADOR. Tu trabajo es coordinar, no ejecutar el trabajo pesado.

### Flujo de cada tarea
1. Lee `.progreso/estado.md` y `.progreso/plan.md` para saber dónde retomar.
2. Si necesitas entender el código, delega en `explorador` (no leas decenas de archivos tú mismo).
3. Para implementar, delega en `ejecutor` con una subtarea clara y acotada.
4. Cuando termine, delega en `revisor` para verificar (tests, calidad, bugs). NO des una tarea por
   buena sin pasar por el revisor. **Excepción (2026-07-02):** si el orquestador corre con **Fable 5**
   (o superior), el subagente `revisor` se **omite**: esa verificación (build, tests, lectura crítica
   del diff) la haces tú mismo antes de dar nada por bueno.
   - Bugs que NO se arreglan en el momento → `.progreso/bugs.md` (créalo si no existe).
   - Si se rompió o replanteó una regla del proyecto → `.progreso/decisiones.md`.
5. Al cerrar: SOBRESCRIBE `.progreso/estado.md` con la foto actual y AÑADE una línea fechada a `.progreso/log.md`.

### Cuándo saltar el harness (subagentes)
Desplegar subagentes **no siempre es necesario**. Si la tarea es sencilla, puedes hacerla tú mismo.
- **No lo decidas por tu cuenta: pregúntamelo primero** ("creo que esto es sencillo, ¿me salto el
  harness multiagente?") y espera respuesta.
- **Lo que NUNCA se salta es [.progreso/](.progreso/)**: leerla al empezar y mantenerla al día es obligatorio siempre.
- Saltar el harness solo afecta al **despliegue de subagentes**, no exime de DESIGN.md ni del checklist de UI.

### Reglas
- No acumules contexto innecesario: si algo requiere leer mucho, va al explorador.
- Una subtarea por delegación; no le pases al ejecutor cosas vagas o gigantes.
- Decisiones técnicas importantes → `.progreso/decisiones.md`. Bugs no resueltos → `.progreso/bugs.md` con estado.

## 9. Convenciones

- **Idioma**: todo en **español** (identificadores en inglés; comentarios y docs en español).
- **Ramas (regla dura)**: dos ramas, **`main`** y **`staging`**. Todo el desarrollo en `staging`
  (o ramas de feature → `staging`). Cuando algo está **finalizado y comprobado**, merge `staging → main`.
  `main` es solo para cambios ya validados; nunca se desarrolla sobre `main`.
- **Componentes**: funcionales, pequeños y modulares. Si un patrón de UI se repite, extráelo. Cero
  hardcode de colores: siempre tokens del sistema.
- **Stack (confirmado 2026-07-02, detalle en decisiones.md)**: **MERN**. Monorepo sin workspaces:
  `client/` (Vite + React + TS, **CSS vanilla con tokens + CSS Modules** — sin Tailwind; PWA con
  fuentes autoalojadas @fontsource; editor **CodeMirror 6**, terminal **xterm.js**) + `server/`
  (Node 20 + Express + TS, **ws** para terminal/chat, `node-pty`, **mongoose**, puente al CLI
  `claude`). **MongoDB** (`mongo:7` en Docker, red interna, con auth) para sesiones de chat y
  ajustes; el estado real de los proyectos sigue siendo el filesystem del VPS. No inventes libs
  sin anotarlo como decisión.
- No inventes decisiones pendientes (libs concretas, detalles del puente `claude`, multi-VPS): **pregunta o anótalo**.

## 10. Comandos

> Aún **no hay stack montado** (esto es el arranque del proyecto). Cuando se scaffolde, esta sección
> tendrá los comandos reales (`npm run dev`, etc.), como en el proyecto SmartPeak. De momento:

```bash
bash scripts/init.sh        # arranque de sesión: muestra el estado actual del proyecto
```

Entorno del VPS (verificado): **Node v20**, **npm 9**, **git 2.47**, **`claude` CLI 2.1.197**
instalado (alias `clauded` = `claude --dangerously-skip-permissions`).

## 11. Seguridad (regla dura)

PortaIDE expone a la red un **filesystem + shell + un agente de IA** sobre mi VPS. El borde tiene que
estar blindado **antes** de exponerlo:

- **Autenticación obligatoria** en todo el backend (es de un solo usuario, pero abierto a internet):
  nada de FS/pty/chat sin sesión válida. **HTTPS/TLS** siempre.
- El uso de `--dangerously-skip-permissions` (alias `clauded`) es aceptable **dentro** (mi máquina,
  mi herramienta), pero implica que **cualquiera que pase el borde puede ejecutar cualquier cosa**:
  por eso auth + TLS + no exponer puertos de más no son opcionales.
- Trata `.env`, claves y tokens como secretos: nunca en el repo, nunca en logs, nunca al cliente.
