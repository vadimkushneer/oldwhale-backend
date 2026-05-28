# Hoster.KZ VPS Deployment

The lightweight backend is designed to run on the small Ubuntu VPS without Docker, PostgreSQL, or Redis.

## Runtime

- Node.js 22.13+ with `node:sqlite`.
- One backend process only. Do not use PM2 cluster mode because background jobs are in-memory.
- Persistent SQLite file, for example `/var/lib/oldwhale/oldwhale.sqlite`.

## Example systemd service

```ini
[Unit]
Description=Old Whale Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/oldwhale/oldwhale-backend
Environment=NODE_ENV=production
Environment=PORT=8080
Environment=SQLITE_PATH=/var/lib/oldwhale/oldwhale.sqlite
EnvironmentFile=/etc/oldwhale/backend.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
User=oldwhale
Group=oldwhale

[Install]
WantedBy=multi-user.target
```

Nginx should proxy `/api`, `/health`, `/swagger`, and `/openapi.yaml` to `http://127.0.0.1:8080` while serving the frontend static files.
