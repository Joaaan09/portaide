# ---- Etapa 1: build (compila TypeScript a dist/) ----
FROM node:20-alpine AS builder

WORKDIR /app

# Dependencias (incluye devDependencies: necesitamos tsc para el build)
COPY package*.json ./
RUN npm ci

# Código fuente y compilación (tsc -> dist/)
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Etapa 2: runtime (solo dependencias de producción) ----
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Solo dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# JS ya compilado desde la etapa de build
COPY --from=builder /app/dist ./dist

# Puerto interno (no se publica: lo alcanza el nginx del frontend por la red interna)
EXPOSE 4100

# Healthcheck contra el endpoint de salud de la API
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
