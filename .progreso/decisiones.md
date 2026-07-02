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

### 2026-07-02 · Sin base de datos en v1

- **Decisión:** v1 **no** monta una base de datos. El estado real es el **filesystem** del VPS; para
  sesiones de chat y ajustes basta un **store ligero** (JSON/SQLite) a decidir en implementación.
- **Motivo:** es una herramienta personal de un solo usuario; una DB añade complejidad sin valor claro
  al principio. (Contrasta con SmartPeak, que sí usa MongoDB por su naturaleza de datos.)
- **Alternativas descartadas:** MongoDB/Postgres desde el día 1 (sobredimensionado para v1).

---

## Pendientes de decidir (no inventar; preguntar o resolver en implementación)

- **Stack concreto de libs**: editor (**CodeMirror 6** propuesto por ser mejor en móvil, vs Monaco),
  terminal (**xterm.js**), WebSocket (**ws**), pty (**node-pty**), store de sesión/ajustes (JSON vs SQLite).
- **Auth de un solo usuario**: mecanismo exacto (passphrase + token de sesión, cookie httpOnly, …) — §11.
- **Detalles del puente `claude`** (ver entrada de arriba).
- **Multi-VPS por SSH**: si algún día se retoma, definir aquí el modelo.
