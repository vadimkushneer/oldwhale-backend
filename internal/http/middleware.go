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
	allowed := normalizeCORSOrigin(rawOrigin)
	return func(next stdhttp.Handler) stdhttp.Handler {
		return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
			o := allowed
			if o == "" {
				o = "*"
			}
			w.Header().Set("Access-Control-Allow-Origin", o)
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

func normalizeCORSOrigin(raw string) string {
	o := strings.TrimSpace(raw)
	o = strings.Trim(o, `"'`)
	if o == "" {
		return ""
	}
	if o == "*" {
		return "*"
	}
	u, err := url.Parse(o)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		slog.Warn("invalid CORS_ORIGIN; using wildcard", "raw", raw)
		return ""
	}
	return u.Scheme + "://" + u.Host
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
