package main

import (
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"

	"github.com/oldwhale/backend/internal/api"
	"github.com/oldwhale/backend/internal/db"
)

func main() {
	_ = godotenv.Load()

	d, err := db.OpenFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	defer d.Close()

	if err := api.SeedAdmin(d); err != nil {
		log.Printf("seed admin: %v", err)
	}

	secret := []byte(os.Getenv("JWT_SECRET"))
	if len(secret) < 16 {
		secret = []byte("dev-secret-change-me-32chars!!")
		log.Println("warning: using default JWT_SECRET; set JWT_SECRET in production")
	}

	ttl := 72 * time.Hour
	srv := &api.Server{DB: d, JWTSecret: secret, JWTTTL: ttl}

	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/auth/register", srv.Register)
	mux.HandleFunc("POST /api/auth/login", srv.Login)
	mux.HandleFunc("GET /health", srv.Health)
	mux.HandleFunc("GET /openapi.yaml", api.OpenAPISpec)
	mux.HandleFunc("GET /openapi.json", api.OpenAPISpecJSON)
	mux.HandleFunc("GET /swagger", api.SwaggerUI)

	authStack := api.BearerUser(secret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/me":
			api.RequireAuth(http.HandlerFunc(srv.Me)).ServeHTTP(w, r)
		case r.Method == http.MethodGet && r.URL.Path == "/api/admin/users":
			api.RequireAuth(api.RequireAdmin(http.HandlerFunc(srv.AdminListUsers))).ServeHTTP(w, r)
		case r.Method == http.MethodPost && r.URL.Path == "/api/admin/users":
			api.RequireAuth(api.RequireAdmin(http.HandlerFunc(srv.AdminCreateUser))).ServeHTTP(w, r)
		case (r.Method == http.MethodPatch || r.Method == http.MethodDelete) && len(r.URL.Path) > len("/api/admin/users/") && r.URL.Path[:len("/api/admin/users/")] == "/api/admin/users/":
			if r.Method == http.MethodPatch {
				api.RequireAuth(api.RequireAdmin(http.HandlerFunc(srv.AdminPatchUser))).ServeHTTP(w, r)
			} else {
				api.RequireAuth(api.RequireAdmin(http.HandlerFunc(srv.AdminDeleteUser))).ServeHTTP(w, r)
			}
		default:
			http.NotFound(w, r)
		}
	}))

	mux.Handle("/api/", authStack)

	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		if p := os.Getenv("PORT"); p != "" {
			addr = ":" + p
		} else {
			addr = ":8080"
		}
	}

	corsOrigin := normalizeCORSOrigin(os.Getenv("CORS_ORIGIN"))

	handler := api.CORS(corsOrigin)(mux)

	log.Printf("Old Whale API listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, handler))
}

// normalizeCORSOrigin returns a value suitable for Access-Control-Allow-Origin, or "" to mean wildcard.
// App Platform / dashboards sometimes store a mistaken "secret" in CORS_ORIGIN (e.g. ciphertext starting with "EV[");
// that is not a valid origin and browsers reject it — treat as unset.
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
		log.Printf("warning: CORS_ORIGIN is not a valid http(s) origin (raw=%q); using Access-Control-Allow-Origin: *", raw)
		return ""
	}
	return u.Scheme + "://" + u.Host
}
