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
**Herramienta personal** (un solo usuario, yo por ahora): conecta con **mi VPS** (con **Claude Code
instalado**) para trabajar con mis proyectos desde el teléfono. Instalable como **PWA** (standalone,
vertical). El corazón es el **chat de IA con la misma estructura que Claude Code en VS Code** (§4).

Lema de marca: *"Portable IDE — code on your VPS from anywhere, with Claude Code built in."*

## 2. Arquitectura (v1 — decidida)

**El servidor de PortaIDE corre en el propio VPS.** No hay puente SSH en v1: el backend accede al
**filesystem local**, lanza la **shell local** y lanza **`claude` local**. El móvil entra por
**HTTPS + WebSocket**. (Multi-VPS por SSH queda como futuro; ver [.progreso/decisiones.md](.progreso/decisiones.md).)

- **Filesystem**: API para árbol, leer y escribir archivos del proyecto abierto (vista *Files* / *Editor*).
- **Terminal**: `pty` real por WebSocket (vista *Terminal*). Teclas especiales para móvil.
- **Chat IA**: se apoya en el **CLI `claude`** (ver §4), no reimplementa el agente.
- **Despliegue**: **Docker Compose tras Nginx Proxy Manager** (patrón de este VPS): red externa
  `reverse_proxy_network` con NPM (termina TLS), frontend nginx con `expose 80` (sin `ports:` al host),
  backend en red interna (SQLite embebido, sin contenedor de BD), healthchecks encadenados, secretos
  vía `.env` (gitignored) + `.env.example`. Modelo a imitar: **SmartPeak** (`../smartpeak`); detalle y
  peculiaridades de PortaIDE (montajes del host, WS) en [decisiones.md](.progreso/decisiones.md) ("Despliegue").

## 3. Las 5 vistas (norte de producto)

La app tiene **5 destinos**. Navegación (revisado 2026-07-03, ver [decisiones.md](.progreso/decisiones.md)):
**drawer con hamburguesa `☰` por defecto** + **barra inferior alternativa**, intercambiables en Settings
(ya **no** la isla dinámica flotante). Vistas, definidas en el mockup (§5):

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
- Alias en el VPS: **`clauded` = `claude --dangerously-skip-permissions`** (skip de permisos). Aceptable
  por ser **mi máquina, herramienta de un solo usuario**, pero **eleva el listón de seguridad de red**
  (§11): si el agente toca todo sin pedir permiso, el borde (auth + HTTPS) debe estar blindado.
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

**Skills de diseño (craft).** En UI sigue las skills instaladas (`emil-design-eng`, `review-animations`,
`design-taste-frontend`, en `.claude/skills/`) para **motion, interacción y pulido**. Son **guía, no
autoridad**: ante conflicto **manda DESIGN.md**. Usa `review-animations` como rúbrica de animaciones.

## 6. Orden de construcción

**Fase 1 — Bloquear el sistema de diseño** (antes de features): tokens CSS de los 3 temas + fuentes
→ shell móvil (nav + status bar) → **vista Chat** (la estrella) hasta clavar el tono. Iterar solo
sobre shell + Chat.

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

Eres el ORQUESTADOR, pero **por defecto operas en Modo Directo** (ejecutas tú el cambio y respondes).
Coordinar subagentes es la **excepción**: solo para tareas de alto impacto y **con mi autorización
explícita** (ver protocolo). El flujo con arnés (más abajo) solo aplica cuando autorizo el "Sí".

### Protocolo crítico de activación de subagentes (modo interactivo)

1. **Filtro de entrada obligatorio:**
   - Ante CUALQUIER petición, evalúa su complejidad y **por defecto opera en Modo Directo** (tú solo, como Orquestador, ejecutas el cambio y respondes).
   - Queda ESTRICTAMENTE PROHIBIDO invocar a `explorador`, `ejecutor` o `revisor` sin autorización explícita.
   - **Lo que NUNCA se salta es [.progreso/](.progreso/)**: leerla al empezar y mantenerla al día es obligatorio siempre, también en Modo Directo (que solo evita el **despliegue de subagentes**, no exime de DESIGN.md ni del checklist de UI).

2. **Criterios de complejidad para preguntar:**
   - Solo si la tarea implica: creación de módulos/vistas desde cero, refactorizaciones masivas de arquitectura, o cambios críticos que afecten a más de 2 archivos a la vez, debes detenerte.

3. **Pregunta de confirmación (botón rojo):**
   - Si se cumplen los criterios de complejidad, DETÉN la ejecución ANTES de llamar a ningún subagente o alterar la carpeta de progreso.
   - Responde al usuario EXACTAMENTE con este formato:
     > "Patrón, esta tarea tiene un impacto arquitectónico alto y requiere precisión quirúrgica. ¿Desea activar el ecosistema de subagentes [Sí] o prefiere que lo resuelva de inmediato en Modo Directo [No]?"
   - Bloquea el flujo y espera la respuesta del usuario. Si responde "Sí", procedes con el arnés completo. Si responde "No", lo resuelves tú solo en el chat principal.

### Flujo cuando el arnés está activado (respondí "Sí")
> Aplica **solo** tras autorizar el arnés; pero los pasos **1 y 5 (`.progreso/`) son obligatorios siempre**, también en Modo Directo. Los pasos 2–4 (delegación) solo con arnés.
1. Lee `.progreso/estado.md` y `.progreso/plan.md` para saber dónde retomar.
2. Si necesitas entender el código, delega en `explorador` (no leas decenas de archivos tú mismo).
3. Para implementar, delega en `ejecutor` con una subtarea clara y acotada.
4. Al terminar, delega en `revisor` (tests, calidad, bugs); NO des una tarea por buena sin él.
   **Excepción (2026-07-02):** con **Fable 5** (o superior) el `revisor` se **omite** y esa verificación
   (build, tests, lectura crítica del diff) la haces tú antes de dar nada por bueno.
   - Bugs que no arreglas ahora → `.progreso/bugs.md` (créalo si falta). Regla replanteada → `.progreso/decisiones.md`.
5. Al cerrar: SOBRESCRIBE `.progreso/estado.md` con la foto actual y AÑADE una línea fechada a `.progreso/log.md`.

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
- **Stack (confirmado 2026-07-02, detalle en decisiones.md)**: React + Express + Node sobre **SQLite**
  (era MERN; Mongo se retiró por SQLite — ver decisiones.md). Monorepo sin workspaces:
  `client/` (Vite + React + TS, **CSS vanilla con tokens + CSS Modules** — sin Tailwind; PWA con
  fuentes autoalojadas @fontsource; editor **CodeMirror 6**, terminal **xterm.js**) + `server/`
  (Node 20 + Express + TS, **ws** para terminal/chat, `node-pty`, **better-sqlite3**, puente al CLI
  `claude`). **SQLite** (`better-sqlite3`, embebido; fichero en volumen Docker) para la meta de las
  sesiones de chat; el estado real de los proyectos sigue siendo el filesystem del VPS. No inventes
  libs sin anotarlo como decisión.
- No inventes decisiones pendientes (libs concretas, detalles del puente `claude`, multi-VPS): **pregunta o anótalo**.

## 10. Comandos

```bash
bash scripts/init.sh        # arranque de sesión: muestra el estado actual del proyecto
npm run install:all         # instalar dependencias (raíz + client + server)
npm run dev                 # dev: client (Vite, :5173) + server (:4100) con concurrently
npm run build               # build de ambos (tsc + vite build / tsc)
npm run typecheck           # typecheck de ambos
docker compose up -d --build  # despliegue en el VPS (requiere .env, ver .env.example)
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
