# PortaIDE — backend (Express + WS + pty + puente al CLI claude).
# Base Debian slim (glibc), NO alpine/musl: el binario `claude` y node-pty son
# más compatibles con glibc (igual que el host del VPS).

# ---- Etapa 1: build (compila TypeScript a dist/ y deja node_modules de prod) ----
FROM node:20-slim AS builder
WORKDIR /app

# Toolchain nativo para compilar node-pty (binario .node).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Descarta devDependencies pero CONSERVA node-pty ya compilado (evita recompilar
# en runtime y arrastrar el toolchain a la imagen final).
RUN npm prune --omit=dev

# ---- Etapa 2: runtime ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production

# Herramientas que viven DENTRO del contenedor y usa la Terminal/agente:
#  - git + bash: la shell del pty y el trabajo con repos.
#  - ca-certificates: TLS saliente (el SDK/CLI habla con la API de Anthropic).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git bash ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# CLI de Claude Code: el binario `claude` que el usuario teclea en la Terminal.
# (El Chat usa el Agent SDK, que trae su propio engine en node_modules; la
# Terminal necesita el binario global en PATH.)
RUN npm i -g @anthropic-ai/claude-code && npm cache clean --force

# `clauded` = claude --dangerously-skip-permissions, como wrapper REAL en PATH
# (más robusto en contenedor que un alias de shell, que depende del rc).
RUN printf '#!/bin/sh\nexec claude --dangerously-skip-permissions "$@"\n' \
      > /usr/local/bin/clauded \
  && chmod +x /usr/local/bin/clauded

# HOME=/home/kuoyii para que ~/.claude (montado desde el host) y las rutas
# absolutas coincidan dentro y fuera. El usuario `node` de la imagen ya es
# UID 1000 = kuoyii en el host, así que puede leer/escribir lo montado.
ENV HOME=/home/kuoyii
RUN mkdir -p /home/kuoyii && chown node:node /home/kuoyii \
  && git config --system --add safe.directory '*'

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

EXPOSE 4100
USER node

# Healthcheck contra el endpoint de salud (habilita depends_on service_healthy)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
