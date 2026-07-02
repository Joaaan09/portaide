# Agentes

Subagentes especializados del proyecto. Un archivo `.md` por agente.

Cada archivo lleva frontmatter:

```markdown
---
name: nombre-del-agente
description: cuándo usar este agente (lo lee el orquestador para decidir)
tools: Read, Edit, Bash   # opcional; por defecto hereda todas
---

Instrucciones / system prompt del agente.
```

Agentes actuales: `explorador` (solo lectura, investigación), `ejecutor` (implementa subtareas),
`revisor` (verifica adversarialmente).

Ideas de agentes para PortaIDE (crear cuando hagan falta):

- `revisor-diseno` — verifica que un PR de UI cumple [DESIGN.md](../../DESIGN.md) (solo tokens `--*`,
  funciona en los 3 temas, tipografía y motion correctos, sin los anti-patrones del §0).
- `revisor-seguridad` — revisa que el borde de red está blindado (auth + TLS en todo endpoint de
  FS/pty/chat) — ver [CLAUDE.md](../../CLAUDE.md) §11.
