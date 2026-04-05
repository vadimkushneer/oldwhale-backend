package main

import (
	"log"
	"net/http"
	"os"
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
		addr = ":8080"
	}

	corsOrigin := os.Getenv("CORS_ORIGIN")

	handler := api.CORS(corsOrigin)(mux)

	log.Printf("Old Whale API listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, handler))
}
