# syntax=docker/dockerfile:1

# ---- Stage 1: build (needs dev dependencies: typescript, @types/*) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: better-sqlite3 ships ready-made binaries (including Alpine/musl), so no compiler is needed,
# and no dependency gets to run an install script during the build.
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Stage 2: runtime (production dependencies and compiled JS only) ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DB_PATH=/data/gateway.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
# The SQLite file lives on a volume mounted at /data; it must be writable by the non-root user.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
