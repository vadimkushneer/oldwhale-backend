# Old Whale Backend

Fresh NestJS backend scaffolded with `@nestjs/cli` on Node.js 26.1.0. The original Go backend was preserved in `../oldwhale-backend.backup-20260510-2332`.

## Run Locally

From the repository root, use the root Docker Compose stack:

```bash
docker compose up --build
```

The API listens on `http://localhost:8080`, Swagger is at `/swagger`, and the preserved OpenAPI contract is served at `/openapi.yaml`.

## Environment

Local Docker uses the repository root `.env` when present. The service requires `DATABASE_URL`; Compose provides a PostgreSQL 18 URL by default for the container network.

## DigitalOcean

Build the included `Dockerfile` and provide runtime environment variables on App Platform, especially `DATABASE_URL`, `JWT_SECRET`, `PORT`, `CORS_ORIGIN`, and `DB_SYNCHRONIZE=false` for managed production databases.
