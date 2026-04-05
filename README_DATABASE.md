# Database: SQLite and PostgreSQL

The Old Whale API stores users in a relational database. The same application binary supports **two backends**:

| Mode | When it is used | Typical use |
|------|-----------------|-------------|
| **PostgreSQL** | Environment variable **`DATABASE_URL`** is set (non-empty after trim) | [DigitalOcean managed DB](https://docs.digitalocean.com/products/databases/), [Render Postgres](https://render.com/docs/databases), Docker, etc. |
| **SQLite** | **`DATABASE_URL`** is unset or empty | Local development, quick demos, single-node file storage |

---

## How the code chooses the driver

1. On startup, `cmd/server` calls `db.OpenFromEnv()` ([internal/db/db.go](internal/db/db.go)).
2. If `DATABASE_URL` is set → open **`pgx`** (via `github.com/jackc/pgx/v5/stdlib`) and run **PostgreSQL** migrations.
3. Otherwise → open **SQLite** at `DB_PATH` or default `./data/oldwhale.db`, create `./data` if needed, run **SQLite** migrations.

Schema is equivalent on both: a single `users` table (`id`, `login`, `email`, `password_hash`, `role`, `disabled`, `created_at`) plus index on `login`. Migrations use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, so restarts and redeploys are safe.

**Important:** PostgreSQL and SQLite are **separate databases**. Switching an existing deployment from SQLite file on disk to Postgres starts with an **empty** `users` table (unless you migrate data yourself). The first boot on an empty Postgres instance still runs **admin seeding** if `CountUsers() == 0` (same as SQLite).

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| **`DATABASE_URL`** | No | Full Postgres URL. If set, SQLite file settings are ignored for the connection. |
| **`DB_PATH`** | No | SQLite file path when `DATABASE_URL` is unset. Default: `./data/oldwhale.db`. |
| **`CORS_ORIGIN`** | No | Single allowed browser `Origin` (e.g. `https://youruser.github.io` for GitHub Pages). If unset, the API sends `Access-Control-Allow-Origin: *`. |
| **`ADMIN_LOGIN`**, **`ADMIN_PASSWORD`**, **`ADMIN_EMAIL`** | No | Used only when the database has **zero** users to create the first admin. |
| **`JWT_SECRET`** | Strongly recommended in production | Signing key for JWTs (16+ characters). |
| **`PORT`** | Set by many hosts (e.g. App Platform) | Listen address is `:$PORT` when **`HTTP_ADDR`** is unset. |
| **`HTTP_ADDR`** | No | If set (e.g. `:8080`), overrides **`PORT`**. On DigitalOcean App Platform, prefer leaving this unset so **`PORT`** is used. |

SQLite-only details: the process needs write access to the directory containing the DB file (and WAL files next to it).

**GitHub Pages + API:** Browsers send `Origin: https://<user>.github.io` (no repository path). Set `CORS_ORIGIN` to exactly that origin if you do not want to rely on `*`.

---

## DigitalOcean App Platform + Managed PostgreSQL

### Connection string (`DATABASE_URL`)

Managed clusters often use a **non-default port** (for example **25060**) and require TLS.

Build the URL from the control panel values (replace placeholders; **never commit real passwords**):

```text
postgres://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
```

Example shape only:

```text
postgres://doadmin:YOUR_PASSWORD@db-postgresql-....db.ondigitalocean.com:25060/defaultdb?sslmode=require
```

- **App and DB in the same VPC/region:** prefer the **private** hostname (`private-db-postgresql-...`) so traffic stays on the internal network.
- **From your laptop:** use the **public** hostname and ensure the DB’s trusted sources / firewall allow your IP.

In **App Platform → your component → Settings → App-Level Environment Variables**, define **`DATABASE_URL`** (DigitalOcean can also bind a database resource so the variable is injected automatically—see [App Platform databases](https://docs.digitalocean.com/products/app-platform/how-to/manage-databases/)).

### CORS for a GitHub Pages frontend

If the SPA is served from `https://<user>.github.io/<repo>/`, set on the App Platform service:

```text
CORS_ORIGIN=https://<user>.github.io
```

Redeploy after changing environment variables.

### Verify

- `GET https://<your-app>.ondigitalocean.app/health` → `{"status":"ok"}` (uses DB `Ping()`).
- Open the GitHub Pages site, register/login; if the browser reports CORS errors, fix `CORS_ORIGIN` or temporarily leave it unset for `*`.

### App Platform build & run (Heroku Go buildpack)

DigitalOcean’s Go apps often use the **Heroku Go buildpack**, which parses `go.mod` and can auto-generate a **Procfile**. Your logs showed:

- **Invalid `go` version** — DigitalOcean’s parser can reject three-part lines such as **`go 1.25.0`** (`invalid go version … must match format 1.23`). This repo uses **`go 1.24`** (two-part form) plus **`toolchain go1.24.11`** so local `go mod tidy` stays reproducible. **`github.com/jackc/pgx/v5`** is pinned to **v5.6.x** (not v5.9+) so the module graph does not force **Go 1.25**, which the buildpack may not understand yet.

- **Custom build command vs Procfile** — If the **custom build command** is `go build … -o app ./cmd/server`, the runnable binary is **`./app`**. The buildpack’s auto-Procfile would otherwise point at **`bin/server`**. The repo includes a **[Procfile](Procfile)** with `web: ./app` so the **web** process runs the same binary the custom build produces.

- **`PORT` vs `HTTP_ADDR`** — App Platform injects **`PORT`**. The server uses **`HTTP_ADDR`** if set; otherwise it listens on **`:` + `PORT`**; otherwise **`:8080`**. For typical DO deploys, **remove `HTTP_ADDR`** from environment variables (or leave it empty) so **`PORT`** is used. If you keep `HTTP_ADDR`, set it to the port the platform expects (often still bind to `:$PORT`).

- **`DATABASE_URL` at runtime** — Postgres connection must be available when the **container runs**, not only at build time. In **Settings → oldwhale-backend component → Environment Variables**, ensure **`DATABASE_URL`** is defined for the running service (same as or in addition to build, per DO UI). If it is build-only, the app will fall back to SQLite on ephemeral disk and data will not match your managed database.

---

## Render.com: Web Service + Postgres

### 1. Create a PostgreSQL instance

1. In the Render dashboard, **New +** → **PostgreSQL**.
2. Choose name, region, and plan.
3. After creation, open the database → **Connections**. Render shows an **Internal Database URL** and an **External Database URL**.

### 2. Link the database to the API (Web Service)

1. Open your **Web Service** (the Old Whale Go app).
2. Go to **Environment** → **Add environment variable**.
3. Add **`DATABASE_URL`**:
   - Prefer the **Internal Database URL** when the API and database are in the **same region** (lower latency, no extra SSL edge cases).
   - Use **External** only if you must connect from outside Render (e.g. local tooling).

Render can also **link** the Postgres resource to the service so `DATABASE_URL` is created automatically—use that if available in your UI.

### 3. Redeploy the Web Service

After `DATABASE_URL` is present, the next deploy runs against Postgres. Verify with `GET /health` and register/login.

### 4. Optional cleanup

If you previously relied on SQLite **on the Web Service’s ephemeral disk**, that file is not used once `DATABASE_URL` is set. User accounts now live only in Postgres.

---

## Local development

### SQLite (default)

```bash
# Unset DATABASE_URL or leave it out of .env
go run ./cmd/server
```

Data file: `./data/oldwhale.db` (or `DB_PATH`).

### PostgreSQL (e.g. Docker)

```bash
docker run --name ow-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=ow -e POSTGRES_DB=ow -p 5432:5432 -d postgres:16
export DATABASE_URL='postgres://ow:dev@localhost:5432/ow?sslmode=disable'
go run ./cmd/server
```

Adjust user, password, database name, and `sslmode` to match your server.

---

## Operations and limitations

- **Backups**: Use your host’s managed DB backups (DigitalOcean, Render, etc.). SQLite backups are file copies of `oldwhale.db` (and `-wal`/`-shm` if WAL mode is on).
- **Connection pool**: Postgres mode sets `SetMaxOpenConns(10)` as a small default; tune later if needed.
- **Migrations**: There is no separate migration CLI; schema is applied in `migrateSQLite` / `migratePostgres`. For additive changes in production, follow normal SQL migration practices (future work if the schema grows).
- **Health check**: `GET /health` calls `Ping()` on the active pool.

---

## Further reading

- [DigitalOcean: Managed PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/)
- [DigitalOcean: App Platform databases](https://docs.digitalocean.com/products/app-platform/how-to/manage-databases/)
- [Render: Deploy PostgreSQL](https://render.com/docs/databases)
- [pgx v5](https://github.com/jackc/pgx)
