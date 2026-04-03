# Old Whale — backend

Go HTTP API: JWT authentication, SQLite storage, user registration/login, and an **admin** area (list users, create test accounts, change role, disable, delete).

## Run

```bash
cp .env.example .env   # optional
go run ./cmd/server
```

Default listen: `:8080`. First run creates `./data/oldwhale.db` and seeds an **admin** user if the database is empty:

- Login: `admin` / `admin123` (override with `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `ADMIN_EMAIL`).

Set `JWT_SECRET` (16+ chars) and `CORS_ORIGIN` (e.g. `http://localhost:5173`) for production.

## API (summary)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Register; returns JWT |
| POST | `/api/auth/login` | — | Login; returns JWT |
| GET | `/api/me` | Bearer | Current user |
| GET | `/api/admin/users` | Bearer admin | List users |
| POST | `/api/admin/users` | Bearer admin | Create user (`login`, `email`, `password`, `role`) |
| PATCH | `/api/admin/users/{id}` | Bearer admin | `disabled`, `role` |
| DELETE | `/api/admin/users/{id}` | Bearer admin | Delete user (not self) |

## As a separate Git repository

```bash
cd oldwhale-backend
git init
git add .
git commit -m "Initial Old Whale backend"
```
