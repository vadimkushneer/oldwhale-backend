#!/usr/bin/env bash
# Smoke-test the API exposed by docker-compose (default http://localhost:8080).
# Requires: curl; plus jq or python3 for parsing the login token.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
# Must match docker-compose.yml `ADMIN_PASSWORD` for the default local stack.
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

die() { echo "ERROR: $*" >&2; exit 1; }

need_cmd() {
	command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

need_cmd curl

TMPDIR=$(mktemp -d "${TMPDIR:-/tmp}/ow-docker-checks.XXXXXX")
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

json_token() {
	if command -v jq >/dev/null 2>&1; then
		jq -r '.token'
	else
		need_cmd python3
		python3 -c 'import sys, json; print(json.load(sys.stdin)["token"])'
	fi
}

echo "==> GET /health"
code=$(curl -sS -o "$TMPDIR/health.json" -w '%{http_code}' "$BASE_URL/health")
[[ "$code" == "200" ]] || die "/health expected HTTP 200, got $code"
grep -q '"status"' "$TMPDIR/health.json" || grep -q '"ok"' "$TMPDIR/health.json" || die "/health body missing expected JSON"

echo "==> GET /openapi.yaml"
code=$(curl -sS -o "$TMPDIR/openapi.yaml" -w '%{http_code}' "$BASE_URL/openapi.yaml")
[[ "$code" == "200" ]] || die "/openapi.yaml expected HTTP 200, got $code"
head -n1 "$TMPDIR/openapi.yaml" | grep -q '^openapi:' || die "/openapi.yaml does not look like OpenAPI YAML"

echo "==> GET /swagger"
code=$(curl -sS -o "$TMPDIR/swagger.html" -w '%{http_code}' "$BASE_URL/swagger")
[[ "$code" == "200" ]] || die "/swagger expected HTTP 200, got $code"
grep -qi swagger "$TMPDIR/swagger.html" || die "/swagger response does not look like Swagger UI HTML"

echo "==> GET /api/ai/models (public catalog)"
code=$(curl -sS -o "$TMPDIR/models.json" -w '%{http_code}' "$BASE_URL/api/ai/models")
[[ "$code" == "200" ]] || die "/api/ai/models expected HTTP 200, got $code"

echo "==> POST /api/auth/login (admin)"
code=$(curl -sS -o "$TMPDIR/login.json" -w '%{http_code}' \
	-H 'Content-Type: application/json' \
	-d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
	"$BASE_URL/api/auth/login")
[[ "$code" == "200" ]] || die "/api/auth/login expected HTTP 200, got $code — check ADMIN_USERNAME/ADMIN_PASSWORD match your compose env"
TOKEN=$(json_token <"$TMPDIR/login.json")

echo "==> GET /api/me"
code=$(curl -sS -o "$TMPDIR/me.json" -w '%{http_code}' \
	-H "Authorization: Bearer $TOKEN" \
	"$BASE_URL/api/me")
[[ "$code" == "200" ]] || die "/api/me expected HTTP 200, got $code"

echo "==> GET /api/admin/users"
code=$(curl -sS -o "$TMPDIR/users.json" -w '%{http_code}' \
	-H "Authorization: Bearer $TOKEN" \
	"$BASE_URL/api/admin/users")
[[ "$code" == "200" ]] || die "/api/admin/users expected HTTP 200, got $code"

echo "==> GET /api/admin/ai/groups"
code=$(curl -sS -o "$TMPDIR/groups.json" -w '%{http_code}' \
	-H "Authorization: Bearer $TOKEN" \
	"$BASE_URL/api/admin/ai/groups")
[[ "$code" == "200" ]] || die "/api/admin/ai/groups expected HTTP 200, got $code"

echo "==> POST /api/admin/ai/env-check"
code=$(curl -sS -o "$TMPDIR/env.json" -w '%{http_code}' \
	-H "Authorization: Bearer $TOKEN" \
	-H 'Content-Type: application/json' \
	-d '{"name":"ANTHROPIC_API_KEY"}' \
	"$BASE_URL/api/admin/ai/env-check")
[[ "$code" == "200" ]] || die "/api/admin/ai/env-check expected HTTP 200, got $code"

echo "All Docker curl checks passed."
