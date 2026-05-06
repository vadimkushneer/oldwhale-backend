# Old Whale — backend

Go HTTP API: JWT authentication, **PostgreSQL-only** persistence ([README_DATABASE.md](README_DATABASE.md)), user registration/login, and an **admin** area (list users, create test accounts, change role, disable, delete).

**Local stack (Docker):** [README_DOCKER.md](README_DOCKER.md) — API and Postgres each run in their own container; **`DATABASE_URL`** is required everywhere.

## Run (local, recommended)

```bash
cd oldwhale-backend
docker compose up --build
```

- **API:** [http://localhost:8080](http://localhost:8080)  
- **Swagger UI:** [http://localhost:8080/swagger](http://localhost:8080/swagger)  
- **OpenAPI:** [http://localhost:8080/openapi.yaml](http://localhost:8080/openapi.yaml)  

Postgres is the `db` service in [docker-compose.yml](docker-compose.yml) (credentials there are **for local use only**). **`docker compose up --build` does not wipe your data** — it lives in the named Docker volume `ow_pgdata` until you run `docker compose down -v` or remove that volume. Details: [README_DOCKER.md](README_DOCKER.md#database-persistence-with-docker-compose).

### Smoke-test the stack (`curl`)

After the API responds on port **8080** (wait until `docker compose` shows the `api` service healthy):

```bash
./scripts/docker-curl-checks.sh
```

The script hits `/health`, `/openapi.yaml`, `/swagger`, the public AI catalog, admin login (`ADMIN_USERNAME` / `ADMIN_PASSWORD` from [docker-compose.yml](docker-compose.yml) by default: `admin` / `admin123`), `/api/me`, `/api/admin/users`, `/api/admin/ai/groups`, and `/api/admin/ai/env-check`. Override the base URL or credentials if needed:

```bash
BASE_URL=http://127.0.0.1:8080 ADMIN_USERNAME=admin ADMIN_PASSWORD=admin123 ./scripts/docker-curl-checks.sh
```

Requires **curl** and either **jq** or **python3** (for parsing the JWT from the login response).

If login fails with **401**, the admin password in the database may not match your current **`ADMIN_PASSWORD`** (for example after changing compose env while the Postgres volume still holds an older admin row). Point **`ADMIN_USERNAME`** / **`ADMIN_PASSWORD`** at the credentials that match the DB, or reset data with **`docker compose down -v`** and bring the stack up again.

### Run on the host with `go run` (optional)

You need a reachable Postgres and **`DATABASE_URL`** (see `.env.example`). Example after `docker compose up -d db` only:

```bash
cp .env.example .env   # edit DATABASE_URL if needed
go run ./cmd/server
```

Without **`DATABASE_URL`**, the server exits on startup.

- First admin when DB is empty is seeded from required **`ADMIN_USERNAME`** and **`ADMIN_PASSWORD`** (optional **`ADMIN_EMAIL`**, default `admin@oldwhale.local`).

Set **`JWT_SECRET`** (16+ chars). Set **`CORS_ORIGIN`** for your frontend as a **plain text** value (e.g. `http://localhost:5173` or `https://youruser.github.io` — **origin only, no path**). On DigitalOcean App Platform, do **not** use an encrypted secret or bindable for `CORS_ORIGIN`; if the env value looks like `EV[...]`, browsers will reject it. Use a normal environment string, or leave unset for `*`.

`CORS_ORIGIN` accepts a **comma-separated allowlist**. The middleware echoes whichever entry matches the request's `Origin` header (and adds `Vary: Origin`); if none match, the first entry is used as a fallback so single-origin deployments behave exactly as before. Custom schemes are accepted — for Capacitor WebViews include `https://localhost` (Android, with `androidScheme: "https"`) and `capacitor://localhost` (iOS default). Example: `CORS_ORIGIN=http://localhost:5173,https://localhost,capacitor://localhost`.

## Deploy (DigitalOcean, etc.)

Use the **[Dockerfile](Dockerfile)** on App Platform (or another registry) so production matches local Docker. Set **`DATABASE_URL`**, **`JWT_SECRET`**, **`PORT`** / **`HTTP_ADDR`** as in [README_DOCKER.md](README_DOCKER.md) and [README_DATABASE.md](README_DATABASE.md). On **DigitalOcean App Platform**, if **`DATABASE_URL`** stays a literal `${db-name.DATABASE_URL}` string, the deploy will fail until the bindable resolves or you paste a real URI—see [README_DATABASE.md — DO App Platform: DATABASE_URL not substituted](README_DATABASE.md#do-app-platform-database_url-not-substituted).

## API (summary)

**Swagger:** `GET /swagger` — **OpenAPI:** `GET /openapi.yaml` (`internal/http/openapi.yaml`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Liveness; checks DB `Ping()` |
| GET | `/swagger` | — | Swagger UI |
| GET | `/openapi.yaml` | — | OpenAPI 3.0 (YAML) |
| POST | `/api/auth/register` | — | Register; returns JWT |
| POST | `/api/auth/login` | — | Login; returns JWT |
| GET | `/api/me` | Bearer | Current user |
| GET | `/api/admin/users` | Bearer admin | List users |
| POST | `/api/admin/users` | Bearer admin | Create user (`username`, `email`, `password`, `role`) |
| PATCH | `/api/admin/users/{uid}` | Bearer admin | `disabled`, `role` |
| DELETE | `/api/admin/users/{uid}` | Bearer admin | Delete user (not self) |
| GET | `/api/admin/me/ui-settings` | Bearer admin | Admin UI prefs (e.g. AI chat log column visibility) |
| PUT | `/api/admin/me/ui-settings` | Bearer admin | Merge `aiChatLogTable.columns` |

## Codegen

`internal/schema/schema.sql` is the DB schema source of truth and `internal/http/openapi.yaml` is the API contract source of truth. Run `make generate` to regenerate committed sqlc and oapi-codegen output.

Set `RESET_SCHEMA_ON_START=true` to drop and recreate disposable local data on startup. AI model groups store `api_key_env_var` only; the actual provider key is read from process env immediately before an upstream call. Admin env diagnostics use `POST /api/admin/ai/env-check` and return only `{name, present}`.

## As a separate Git repository

```bash
cd oldwhale-backend
git init
git add .
git commit -m "Initial Old Whale backend"
```
