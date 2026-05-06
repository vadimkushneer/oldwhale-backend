package http

import (
	"context"
	"log/slog"
	stdhttp "net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/oldwhale/backend/internal/auth"
)

type ctxKey int

const (
	userUIDKey ctxKey = iota + 1
	userRoleKey
)

func Recover(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		defer func() {
			if v := recover(); v != nil {
				slog.Error("panic recovered", "panic", v)
				jsonErr(w, stdhttp.StatusInternalServerError, "server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func SlogLogger(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		slog.Info("http request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(start).String())
	})
}

func CORS(rawOrigin string) func(stdhttp.Handler) stdhttp.Handler {
	allowed := parseCORSAllowlist(rawOrigin)
	wildcard := len(allowed) == 0 || allowed[0] == "*"
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, o := range allowed {
		allowedSet[o] = struct{}{}
	}
	return func(next stdhttp.Handler) stdhttp.Handler {
		return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
			origin := r.Header.Get("Origin")
			switch {
			case wildcard:
				w.Header().Set("Access-Control-Allow-Origin", "*")
			case origin != "":
				if _, ok := allowedSet[origin]; ok {
					w.Header().Set("Access-Control-Allow-Origin", origin)
				} else {
					/*
					 * Default to the first configured origin so existing
					 * curl/single-origin deployments behave as before
					 * (previously the middleware always emitted the configured
					 * origin regardless of request).
					 */
					w.Header().Set("Access-Control-Allow-Origin", allowed[0])
				}
				w.Header().Set("Vary", "Origin")
			default:
				w.Header().Set("Access-Control-Allow-Origin", allowed[0])
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Max-Age", "86400")
			if r.Method == stdhttp.MethodOptions {
				w.WriteHeader(stdhttp.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

/*
parseCORSAllowlist accepts the value of the CORS_ORIGIN env var and returns
the set of allowed browser origins.

Accepted formats:

  - "" (unset)               -> nil (caller treats as wildcard "*")
  - "*"                       -> []string{"*"}
  - "https://a.example"       -> []string{"https://a.example"}
  - "https://a, https://b"    -> []string{"https://a", "https://b"}
  - mix of valid + garbage    -> only valid entries kept; if none survive,
    the function returns nil (= wildcard) and logs a warning.

Each entry is canonicalised to "scheme://host[:port]" with no trailing slash
or path so it can be compared verbatim against the browser's `Origin`
header. This is the value Capacitor's WebView sends as `https://localhost`
on Android (with `androidScheme: "https"`) and `capacitor://localhost` on
iOS — both of which can be added to the allowlist alongside the regular
Vite dev origin (`http://localhost:5173`) without further code changes.
*/
func parseCORSAllowlist(raw string) []string {
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.Trim(cleaned, `"'`)
	if cleaned == "" {
		return nil
	}
	if cleaned == "*" {
		return []string{"*"}
	}
	parts := strings.Split(cleaned, ",")
	out := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, p := range parts {
		entry := strings.TrimSpace(p)
		entry = strings.Trim(entry, `"'`)
		if entry == "" {
			continue
		}
		u, err := url.Parse(entry)
		if err != nil || u.Scheme == "" || u.Host == "" {
			slog.Warn("ignoring invalid CORS_ORIGIN entry", "entry", entry)
			continue
		}
		canonical := u.Scheme + "://" + u.Host
		if _, dup := seen[canonical]; dup {
			continue
		}
		seen[canonical] = struct{}{}
		out = append(out, canonical)
	}
	if len(out) == 0 {
		slog.Warn("no valid CORS_ORIGIN entries; using wildcard", "raw", raw)
		return nil
	}
	return out
}

func BearerUser(secret []byte) func(stdhttp.Handler) stdhttp.Handler {
	return func(next stdhttp.Handler) stdhttp.Handler {
		return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
			h := r.Header.Get("Authorization")
			if h == "" || !strings.HasPrefix(strings.ToLower(h), "bearer ") {
				next.ServeHTTP(w, r)
				return
			}
			c, err := auth.ParseJWT(secret, strings.TrimSpace(h[7:]))
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}
			ctx := context.WithValue(r.Context(), userUIDKey, c.UserUID)
			ctx = context.WithValue(ctx, userRoleKey, c.Role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireAuth(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if _, ok := UserUID(r); !ok {
			jsonErr(w, stdhttp.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func RequireAdmin(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if UserRole(r) != "admin" {
			jsonErr(w, stdhttp.StatusForbidden, "admin only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func UserUID(r *stdhttp.Request) (uuid.UUID, bool) {
	uid, ok := r.Context().Value(userUIDKey).(uuid.UUID)
	return uid, ok
}

func UserRole(r *stdhttp.Request) string {
	role, _ := r.Context().Value(userRoleKey).(string)
	return role
}
