# syntax=docker/dockerfile:1

# ---- Stage 1: build the static site ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: no dependency gets to run an install script during the build.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ---- Stage 2: serve it with nginx (the "unprivileged" image runs as uid 101 and listens on 8080) ----
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
