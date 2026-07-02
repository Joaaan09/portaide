# ---- Etapa 1: build del bundle de Vite ----
FROM node:20-alpine AS builder

WORKDIR /app

# Dependencias (incluye devDependencies: vite, typescript, etc.)
COPY package*.json ./
RUN npm ci

# Código fuente y build de producción
COPY . .
RUN npm run build

# ---- Etapa 2: servir estáticos con Nginx ----
FROM nginx:alpine

# Configuración SPA + proxy de /api y /ws al backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Bundle compilado
COPY --from=builder /app/dist /usr/share/nginx/html

# Puerto interno (no se publica: lo alcanza Nginx Proxy Manager por la red compartida)
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
