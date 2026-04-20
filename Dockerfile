# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Instalar pnpm
RUN npm install -g pnpm@10

# Copiar archivos de dependencias
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

# Instalar todas las dependencias (incluye devDependencies para el build)
RUN pnpm install --frozen-lockfile

# Copiar el resto del código
COPY . .

# Build del frontend (Vite) + backend (esbuild)
RUN pnpm build

# ─── Stage 2: Producción ─────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Instalar pnpm
RUN npm install -g pnpm@10

# Copiar archivos de dependencias
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

# Instalar TODAS las dependencias (vite es requerido en runtime por el servidor)
RUN pnpm install --frozen-lockfile

# Copiar el build generado
COPY --from=builder /app/dist ./dist

# Copiar archivos de configuración de DB
COPY drizzle/ ./drizzle/
COPY drizzle.config.ts ./

# Puerto de la aplicación
EXPOSE 3000

# Variable de entorno para producción
ENV NODE_ENV=production

# Comando de inicio
CMD ["node", "dist/index.js"]
