# syntax=docker/dockerfile:1

FROM node:26.1.0-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:26.1.0-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:26.1.0-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/openapi.yaml ./openapi.yaml
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
