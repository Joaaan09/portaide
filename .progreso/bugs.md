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
