# PostgreSQL configuration

The API uses **PostgreSQL only** via **`DATABASE_URL`**. There is no SQLite or file database inside the app. See **[README_DOCKER.md](README_DOCKER.md)** for local Docker Compose and DigitalOcean Dockerfile deployment.

---

## How it works

1. On startup, `cmd/server` calls `db.OpenFromEnv()` ([internal/db/db.go](internal/db/db.go)).
2. If **`DATABASE_URL`** is missing or blank, the process **exits** with an error (no silent fallback).
3. If set, the app opens **`pgx`** (`github.com/jackc/pgx/v5/stdlib`), runs migrations (`CREATE TABLE IF NOT EXISTS users …`), and serves HTTP.

The first time the **`users`** table is empty, **admin seeding** runs using `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `ADMIN_EMAIL` (see `.env.example`).

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| **`DATABASE_URL`** | **Yes** | PostgreSQL URI, e.g. `postgres://user:pass@host:5432/dbname?sslmode=require` |
| **`JWT_SECRET`** | Strongly recommended (16+ chars) | JWT signing key |
| **`CORS_ORIGIN`** | No | Single allowed browser `Origin`. If unset, `Access-Control-Allow-Origin: *` |
| **`ADMIN_LOGIN`**, **`ADMIN_PASSWORD`**, **`ADMIN_EMAIL`** | No | First admin when DB has zero users |
| **`PORT`** | Set by many hosts | Listen on `:$PORT` when **`HTTP_ADDR`** is unset |
| **`HTTP_ADDR`** | No | If set, overrides **`PORT`** for the listen address |

**GitHub Pages:** browsers send `Origin: https://<user>.github.io` (no path). Set **`CORS_ORIGIN`** to that value if you do not want `*`.

---

## DigitalOcean App Platform + Managed PostgreSQL

Managed clusters often use port **25060** and **`sslmode=require`**.

```text
postgres://USER:PASSWORD@HOST:25060/DATABASE?sslmode=require
```

- Prefer **VPC / private** hostnames when the app and DB are in the same region.
- **`DATABASE_URL`** must be available at **runtime** for the web component (not only at build time).

CORS, health checks, buildpack vs Dockerfile notes: **[README_DOCKER.md](README_DOCKER.md)** and the “App Platform build & run” section below.

### DO App Platform: DATABASE_URL not substituted

That string is a **DigitalOcean bindable placeholder**. App Platform is supposed to replace `${your-db-component.DATABASE_URL}` with a real `postgres://…` URI **before** your container starts. If the process still sees the literal `${…}`, the driver fails and health checks get **connection refused** because the server never listens.

**Fix (pick one):**

1. **Bindable reference (recommended when the DB is part of the same app)**  
   - In the control panel, add **PostgreSQL** as a **database component** of this app (or confirm its **component name**, e.g. `production-database`).  
   - On the **web service** (the component that runs this API), open **Environment variables** → set **`DATABASE_URL`** for **Runtime** (and **Build** only if your setup requires DB access at build, which this app does not).  
   - Set the value using **Insert reference** → choose that database → **`DATABASE_URL`**, so the UI stores the bindable (same idea as `${db-name.DATABASE_URL}` in an [app spec](https://docs.digitalocean.com/products/app-platform/reference/app-specification/)).  
   - The segment before `.DATABASE_URL` must be the **exact** database component `name` from your app. After deploy, use **Runtime logs** or **Console** and `echo "$DATABASE_URL"` — you should see `postgres://…`, not `${…}`.

2. **Pasted URI (works for standalone managed DBs or when bindables do not apply)**  
   Copy the **Connection string** from the managed database’s **Connection details** and set **`DATABASE_URL`** on the web service to that full URI (often with `sslmode=require`). Treat it as a secret; rotate if it leaks.

**Common mistakes:** defining **`DATABASE_URL`** only under **build-time** envs; using a bindable for a database **outside** this app without pasting a real URI; typing `${…}` as plain text without the platform treating it as a reference. Official overview: [How to use environment variables in App Platform](https://docs.digitalocean.com/products/app-platform/how-to/use-environment-variables/).

### App Platform build & run (Heroku Go buildpack)

If you deploy **without** Docker and use the Go buildpack:

- Use a valid **`go` directive** in `go.mod` (see repo).
- **[Procfile](Procfile)** uses **`web: ./app`** to match a custom **`go build -o app`** command.
- Prefer **`PORT`** over hard-coded **`HTTP_ADDR`** on App Platform.

---

## Render.com (optional)

1. Create **PostgreSQL**, copy **Internal** or **External** URL.  
2. On the **Web Service**, set **`DATABASE_URL`**.  
3. Redeploy; check **`GET /health`**.

---

## Operations

- **Backups:** use your provider’s managed Postgres backups.  
- **Connection pool:** `SetMaxOpenConns(10)` by default ([internal/db/db.go](internal/db/db.go)).  
- **Migrations:** applied at startup (`CREATE IF NOT EXISTS`); no separate CLI.  
- **Health:** `GET /health` uses `Ping()` on the pool.

---

## Further reading

- [README_DOCKER.md](README_DOCKER.md) — Docker Compose + Dockerfile + DigitalOcean  
- [DigitalOcean: Managed PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/)  
- [Render: PostgreSQL](https://render.com/docs/databases)  
- [pgx v5](https://github.com/jackc/pgx)
