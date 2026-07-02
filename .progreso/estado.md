# Estado — checkpoint de la última sesión

> Léeme al empezar. Actualízame al terminar cada sesión.

**Última actualización:** 2026-07-02 (2ª sesión)

## Dónde estamos

**Fase 0 cerrada y Fase 1 implementada** (pendiente solo de QA visual del usuario). Hay app real:
monorepo `client/` + `server/` + capa Docker, con el shell móvil y la **vista Chat completa (mock)**
funcionando. Rama de trabajo: **`staging`** (main solo tiene el commit inicial del harness).

Hecho en esta sesión (commits `354c2ee`, `945b630`, `7605bbf` en staging):

- **Decisiones cerradas** (ver decisiones.md): stack **MERN confirmado por el usuario** (Mongo entra
  en v1, supersede "sin DB"); despliegue **Docker + Nginx Proxy Manager, patrón SmartPeak**
  (explorados smartpeak / total-grind±staging / connectu / fichame con un workflow de agentes);
  libs concretas (CodeMirror 6, xterm.js, ws, node-pty, mongoose, CSS Modules **sin Tailwind**,
  fuentes @fontsource); subagente `revisor` **omitido** cuando el orquestador corre con Fable 5.
- **Scaffolding**: `client/` (Vite + React 19 + TS, PWA con manifest/iconos de brand/, proxy dev
  /api y /ws → :4100), `server/` (Express + TS ESM en **:4100**, `/api/health`, WS eco en `/ws`,
  Mongo opcional con reintentos), Docker completo (compose `portaide-*`, mongo:7 en loopback
  **27018**, montajes del host anotados para Fase 3), scripts raíz con concurrently.
- **Fase 1 UI**: tokens de los 3 temas + `--on-accent` (documentado en DESIGN.md §3 antes de usarlo);
  ThemeProvider persistido; navegación por estado (sin react-router); AppShell (100dvh, glow, fadein);
  **NavIsland** calcada del mockup (píldora ↔ 5 pestañas + scrim, islandOpen/islandScrim,
  reduced-motion, a11y); 4 vistas stub + **vista Chat completa**: pestañas de chats, hilo con
  burbujas/thinking colapsable/tool-cards Read-Edit-Bash (diff + Approve/Reject interactivos),
  typing `dot`, composer fijo con textarea autoexpandible y pie modelo/permission.
- **Verificación** (sin subagente revisor, la hizo el orquestador): builds y typecheck de client y
  server en verde; barrido de colores literales limpio (solo los sancionados por DESIGN); lectura
  crítica de NavIsland/AppShell/Chat; `docker compose config` OK; `/api/health` probado con curl.
  **No se pudo hacer captura en navegador** (el VPS no tiene las libs de sistema de Chromium).
- 2 flecos menores de a11y de la isla anotados en `.progreso/bugs.md`.

## Referencias útiles

- Mockups desempaquetados (HTML real) en el scratchpad de la sesión 2026-07-02; si hacen falta de
  nuevo, extraer el JSON del `<script type="__bundler/template">` de los `*.html` (offline) del repo.
- El puerto **4100** (backend) y el **27018** (mongo loopback) se eligieron para no chocar con
  smartpeak (4000/27017), totalgrind (5000), fichame (3000) y connectu (3900).

## Siguiente paso (propuesto)

1. **QA visual del usuario** en móvil/navegador (`npm run dev`) e **iterar shell + Chat** hasta clavar
   el tono (última casilla de Fase 1). 2. Luego Fase 2 (Files → Editor → Terminal → Settings) contra el
   sistema bloqueado. 3. En paralelo cuando toque: Fase 3 (FS API, pty WS, puente `claude`, auth) —
   la auth de un solo usuario sigue **pendiente de decidir** y es bloqueante para exponer.
