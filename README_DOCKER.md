# Docker, PostgreSQL, and DigitalOcean

The Old Whale API **only** talks to **PostgreSQL**. There is no SQLite or other embedded database. Every environment—local, Docker, or cloud—must provide a valid **`DATABASE_URL`**.

---

## How the pieces fit together

```mermaid
flowchart TB
  subgraph local [Local machine]
    compose[docker compose]
  end
  subgraph stack [Compose stack]
    api[api container]
    pg[db container Postgres]
  end
  compose --> stack
  api -->|"DATABASE_URL tcp://db:5432"| pg
```

1. **PostgreSQL** runs in its own container (`db` in [docker-compose.yml](docker-compose.yml)) with a persistent volume so data survives restarts.
2. **API** runs in a second container (`api`), built from the [Dockerfile](Dockerfile). On startup it reads **`DATABASE_URL`**, opens a pgx pool, and applies [internal/schema/schema.sql](internal/schema/schema.sql).
3. **`depends_on` + `healthcheck`** delay starting the API until Postgres accepts connections, so the first migration/seed does not race a cold database.

---

## Local development (recommended)

### API + Postgres only (`oldwhale-backend` clone)

From the `oldwhale-backend` directory:

```bash
docker compose up --build
```

When **`api`** is listening on **localhost:8080**, smoke-test JSON endpoints and auth:

```bash
./scripts/docker-curl-checks.sh
```

See [README.md — Smoke-test the stack](README.md#smoke-test-the-stack-curl) for variables (**`BASE_URL`**, **`ADMIN_USERNAME`**, **`ADMIN_PASSWORD`**) and prerequisites (**curl**, **jq** or **python3**).

### Full stack: API + Postgres + frontend (monorepo root)

When `oldwhale-backend` and `oldwhale-frontend` sit under one parent folder (e.g. `OldWhale/`), use the parent’s **`docker-compose.yml`** and **`dev-stack.sh`**:

```bash
cd /path/to/OldWhale   # parent of oldwhale-backend and oldwhale-frontend
./dev-stack.sh
```

Frontend runs **Vite in dev mode inside Docker**; GitHub Pages production builds are unaffected.

- **API:** [http://localhost:8080](http://localhost:8080)  
- **Swagger UI:** [http://localhost:8080/swagger](http://localhost:8080/swagger)  
- **Postgres (host tools):** `localhost:5432`, user `ow`, password `owlocal`, database `ow` (see `docker-compose.yml`; do not use these credentials in production).

Stop with `Ctrl+C` or `docker compose down`. To wipe DB data: `docker compose down -v`.

### Database persistence with Docker Compose

**Does `docker compose up --build` wipe the database? No.** PostgreSQL stores its files in the **named volume** `ow_pgdata` (see `volumes:` in [docker-compose.yml](docker-compose.yml)). That volume is **separate from the image**: rebuilding the `api` image or recreating the `api` container does **not** delete `ow_pgdata`. Your tables and rows persist across:

- `docker compose up --build`
- `docker compose up` after `docker compose down` (without `-v`)

**When data is actually removed**

- **`docker compose down -v`** — the `-v` flag removes named volumes declared in this compose file, so **`ow_pgdata` is deleted** and the next `up` starts with an empty database.
- **`docker volume rm <name>`** (or pruning unused volumes) — same effect if the Postgres volume is removed.

**Optional: store data in a folder on your machine**

If you prefer the database files on disk (easy backup, visible in the repo tree), replace the `db` service volume with a **bind mount** (create the directory first; Postgres needs an empty dir or existing data dir):

```yaml
# in docker-compose.yml, under db.volumes, replace:
#   - ow_pgdata:/var/lib/postgresql/data
# with:
#   - ./.docker/pgdata:/var/lib/postgresql/data
```

Then add `.docker/pgdata/` to `.gitignore` if you use a path inside the project. On Linux, the directory may need ownership compatible with the Postgres image UID (often `999`); on macOS Docker Desktop this usually works as-is.

**Optional: truly ephemeral Postgres (e.g. CI)**

Use an **anonymous** volume (omit the named volume and use only a short-lived volume) or a compose **profile** that mounts `tmpfs` — only if you explicitly want a fresh DB every run.

### Running only the binary on the host (optional)

If Postgres is already reachable (for example `db` exposed on `5432` after `docker compose up -d db`):

```bash
export DATABASE_URL='postgres://ow:owlocal@127.0.0.1:5432/ow?sslmode=disable'
export JWT_SECRET='at-least-sixteen-chars!!'
export ADMIN_USERNAME='admin'
export ADMIN_PASSWORD='admin123'
go run ./cmd/server
```

Without **`DATABASE_URL`**, the process exits immediately with an error.

---

## DigitalOcean App Platform (push to Git)

Goal: each git push builds a new **container image** from the **Dockerfile** and runs it with your **managed PostgreSQL** (or any Postgres you provide).

### 1. Managed database

Create a **DigitalOcean Managed PostgreSQL** cluster (or reuse one). Note connection details and build **`DATABASE_URL`** (usually `sslmode=require`, often port **25060**). Prefer the **VPC / private** hostname for the app and DB in the same region—see [README_DATABASE.md](README_DATABASE.md).

### 2. App spec: use Dockerfile

In **App Platform → Settings → Components → your web service**:

- **Build strategy:** use **Dockerfile** (not only the Heroku buildpack). Set **Dockerfile path** to `Dockerfile` at the repo root (this repository).
- **HTTP port / routes:** the container listens on **`PORT`** (the Dockerfile sets default `8080`; App Platform will inject **`PORT`**—leave **`HTTP_ADDR`** unset so the Go server binds to `:$PORT`).

### 3. Runtime environment variables (required)

| Variable | Purpose |
|----------|---------|
| **`DATABASE_URL`** | Full `postgres://…` URI, or an App Platform bindable that resolves to one (see [README_DATABASE.md](README_DATABASE.md#do-app-platform-database_url-not-substituted)). Must be set for the **web** component at **runtime**; a literal unresolved `${…}` value will crash startup and fail health checks. |
| **`JWT_SECRET`** | 16+ random characters. |
| **`CORS_ORIGIN`** | Your frontend origin, e.g. `https://youruser.github.io`. |

Required for first-time admin seed when the `users` table is empty: `ADMIN_USERNAME` and `ADMIN_PASSWORD`; `ADMIN_EMAIL` is optional. Set `RESET_SCHEMA_ON_START=true` only for disposable environments where startup should drop and recreate tables.

### 4. Push

Commit and `git push` to the branch connected to App Platform. The platform rebuilds the image and rolls out the new container. Verify **`GET /health`** and Swagger at **`/swagger`**.

### If you still use a custom Go buildpack instead of Docker

You can keep **buildpack + Procfile**, but the running process is still **PostgreSQL-only**: you must set **`DATABASE_URL`** for the **runtime** component. The Dockerfile path is the recommended path so local Docker and production stay aligned.

---

## Image contents

- **Multi-stage build:** compile with `golang:1.26-alpine`, run a minimal **Alpine** image with **CA certificates** (for TLS to managed Postgres).
- **Non-root user:** `nobody`.
- **No database inside the API image:** only the Go binary; all persistence is in the separate Postgres service.
- **Generated code is committed:** Docker builds do not run sqlc or oapi-codegen; run `make generate` locally before building if the schema or OpenAPI contract changes.
- **Provider secrets:** AI catalog rows store env var names such as `ANTHROPIC_API_KEY`. The key value stays in container env and admin diagnostics use `/api/admin/ai/env-check`, which returns only whether it is present.

---

## Further reading

- [Docker Compose](https://docs.docker.com/compose/)
- [DigitalOcean App Platform from Dockerfile](https://docs.digitalocean.com/products/app-platform/how-to/deploy-from-container-images/)
- [DigitalOcean managed Postgres](https://docs.digitalocean.com/products/databases/postgresql/)
