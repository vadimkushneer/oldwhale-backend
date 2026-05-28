# Old Whale Backend

Lightweight NestJS backend for Old Whale. It keeps the frontend/OpenAPI HTTP contract while replacing PostgreSQL with SQLite and Redis/BullMQ with in-memory job processing.

## Requirements

- Node.js 22.13+ with `node:sqlite` available. The hosting server currently runs Node 22.22.2.
- No PostgreSQL or Redis is required.

## Run Locally

From this directory:

```bash
npm install
cp .env.example .env
npm run start:dev
```

The API listens on `http://localhost:8080`, Swagger is at `/swagger`, and the preserved OpenAPI contract is served at `/openapi.yaml`.

From the repository root, the Docker Compose stack runs the backend plus the Vite frontend:

```bash
docker compose up --build
```

## Data

SQLite defaults to `./data/oldwhale.sqlite`. Set `SQLITE_PATH` to use another file. Runtime database files under `data/` are ignored by Git.

## Hosting Server

Run one backend process only, for example with systemd or PM2, and keep `SQLITE_PATH` on persistent disk. Do not run clustered PM2 mode: the queue is intentionally in-memory.
