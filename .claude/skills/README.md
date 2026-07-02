# Skills

Skills del proyecto: capacidades reutilizables que se invocan con `/<nombre-skill>`.

Cada skill es una carpeta con un `SKILL.md`:

```
.claude/skills/
  mi-skill/
    SKILL.md        # frontmatter (name, description) + instrucciones
    ...             # scripts/recursos auxiliares opcionales
```

Frontmatter mínimo de `SKILL.md`:

```markdown
---
name: mi-skill
description: qué hace y cuándo usarla
---

Pasos / instrucciones de la skill.
```

Ideas de skills para SmartPeak (crear cuando hagan falta):

- `nuevo-widget` — scaffolding de un widget del dashboard `Hoy` siguiendo los tamaños y
  tokens de [DESIGN.md](../../DESIGN.md) §5.
- `checklist-pr-ui` — ejecuta el checklist final de DESIGN.md sobre el diff actual.
