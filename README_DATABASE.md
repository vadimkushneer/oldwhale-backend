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
