#!/usr/bin/env bash
# Old Whale auto-deploy: pull configured origin branches, build on the server,
# and release the backend (systemd) and frontend (nginx static). Idempotent: only
# rebuilds when the tracked branch tip changed (unless --force). Safe for
# concurrent triggers.
set -euo pipefail
export GIT_TERMINAL_PROMPT=0
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

SRC_DIR=/opt/oldwhale/src
REL_DIR=/opt/oldwhale/releases
STATE_DIR=/opt/oldwhale/state
LOG_FILE=/var/log/oldwhale-deploy.log
LOCK_FILE=/run/oldwhale-deploy.lock
WEB_ROOT=/var/www/oldwhale-frontend
BACKEND_REPO=https://github.com/vadimkushneer/oldwhale-backend.git
FRONTEND_REPO=https://github.com/vadimkushneer/oldwhale-frontend.git
FRONTEND_API_URL="${OLDWHALE_FRONTEND_API_URL:-}"
DEPLOY_BRANCHES_FILE="${HOSTING_DEPLOY_BRANCHES_PATH:-/etc/oldwhale/deploy-branches.json}"

mkdir -p "$SRC_DIR" "$REL_DIR" "$STATE_DIR"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE" >&2; }

read_branch() {
  local key="$1" fallback="$2"
  if [ ! -f "$DEPLOY_BRANCHES_FILE" ]; then
    echo "$fallback"
    return 0
  fi
  python3 - "$DEPLOY_BRANCHES_FILE" "$key" "$fallback" <<'PY'
import json, sys
path, key, fallback = sys.argv[1:4]
try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    value = data.get(key, fallback)
    if isinstance(value, str) and value.strip():
        print(value.strip())
    else:
        print(fallback)
except Exception:
    print(fallback)
PY
}

BACKEND_BRANCH="$(read_branch backend_branch main)"
FRONTEND_BRANCH="$(read_branch frontend_branch main)"

sync_repo() {
  # stdout: resolved origin/<branch> sha (only). logs go to stderr/file.
  local name="$1" url="$2" branch="$3" dir="$SRC_DIR/$1"
  if [ ! -d "$dir/.git" ]; then
    log "$name: cloning $url (branch $branch)"
    git clone --branch "$branch" "$url" "$dir" >>"$LOG_FILE" 2>&1
  fi
  git -C "$dir" remote set-url origin "$url"
  git -C "$dir" fetch --prune origin "$branch" >>"$LOG_FILE" 2>&1
  git -C "$dir" rev-parse "origin/$branch"
}

is_changed() {
  local name="$1" sha="$2" state="$STATE_DIR/$1.sha"
  [ "$force" = "--force" ] && return 0
  [ -f "$state" ] && [ "$(cat "$state")" = "$sha" ] && return 1
  return 0
}

deploy_backend() {
  local sha dir rel branch="$BACKEND_BRANCH"
  sha="$(sync_repo oldwhale-backend "$BACKEND_REPO" "$branch")"
  if ! is_changed oldwhale-backend "$sha"; then log "backend: up to date (${branch}@${sha})"; return 0; fi
  log "backend: building ${branch}@${sha}"
  dir="$SRC_DIR/oldwhale-backend"
  git -C "$dir" reset --hard "origin/$branch" >>"$LOG_FILE" 2>&1
  git -C "$dir" clean -fd >>"$LOG_FILE" 2>&1
  ( cd "$dir" && npm ci --include=dev >>"$LOG_FILE" 2>&1 && npm run build >>"$LOG_FILE" 2>&1 )
  rel="$REL_DIR/backend-$(date -u +%Y%m%d%H%M%S)-${sha:0:8}"
  mkdir -p "$rel"
  cp -a "$dir/package.json" "$dir/package-lock.json" "$dir/openapi.yaml" "$dir/dist" "$rel/"
  ( cd "$rel" && npm ci --omit=dev >>"$LOG_FILE" 2>&1 )
  ln -sfn "$rel" /opt/oldwhale/backend-current
  systemctl restart oldwhale-backend
  sleep 2
  curl -fsS http://127.0.0.1:8080/health >/dev/null
  echo "$sha" > "$STATE_DIR/oldwhale-backend.sha"
  log "backend: deployed ${branch}@${sha} OK"
  ls -1dt "$REL_DIR"/backend-* 2>/dev/null | tail -n +6 | xargs -r rm -rf
}

deploy_frontend() {
  local sha dir branch="$FRONTEND_BRANCH"
  sha="$(sync_repo oldwhale-frontend "$FRONTEND_REPO" "$branch")"
  if ! is_changed oldwhale-frontend "$sha"; then log "frontend: up to date (${branch}@${sha})"; return 0; fi
  log "frontend: building ${branch}@${sha}"
  dir="$SRC_DIR/oldwhale-frontend"
  git -C "$dir" reset --hard "origin/$branch" >>"$LOG_FILE" 2>&1
  git -C "$dir" clean -fd >>"$LOG_FILE" 2>&1
  ( cd "$dir" && npm ci --include=dev >>"$LOG_FILE" 2>&1 && VITE_API_URL="$FRONTEND_API_URL" VITE_BASE_PATH=/ npm run build >>"$LOG_FILE" 2>&1 )
  mkdir -p "$WEB_ROOT"
  rm -rf "$WEB_ROOT/dist.new"
  cp -a "$dir/dist" "$WEB_ROOT/dist.new"
  rm -rf "$WEB_ROOT/dist.prev"
  [ -d "$WEB_ROOT/dist" ] && mv "$WEB_ROOT/dist" "$WEB_ROOT/dist.prev"
  mv "$WEB_ROOT/dist.new" "$WEB_ROOT/dist"
  chown -R root:root "$WEB_ROOT/dist"
  nginx -t >>"$LOG_FILE" 2>&1
  systemctl reload nginx
  echo "$sha" > "$STATE_DIR/oldwhale-frontend.sha"
  log "frontend: deployed ${branch}@${sha} OK"
}

target="${1:-all}"
force="${2:-}"

main() {
  case "$target" in
    backend) deploy_backend ;;
    frontend) deploy_frontend ;;
    all) deploy_backend; deploy_frontend ;;
    *) echo "usage: oldwhale-deploy [all|backend|frontend] [--force]" >&2; exit 2 ;;
  esac
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then log "another deploy already running; skipping (${target})"; exit 0; fi
log "deploy start: target=${target} force=${force:-no} backend_branch=${BACKEND_BRANCH} frontend_branch=${FRONTEND_BRANCH}"
main
log "deploy done: target=${target}"
