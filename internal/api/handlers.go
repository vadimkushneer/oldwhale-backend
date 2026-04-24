package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/oldwhale/backend/internal/auth"
	"github.com/oldwhale/backend/internal/db"
	"golang.org/x/crypto/bcrypt"
)

type Server struct {
	DB        *db.Database
	JWTSecret []byte
	JWTTTL    time.Duration
}

type loginReq struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

type registerReq struct {
	Login    string `json:"login"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type createUserReq struct {
	Login    string `json:"login"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

type patchUserReq struct {
	Disabled *bool   `json:"disabled"`
	Role     *string `json:"role"`
}

func (s *Server) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in registerReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	in.Login = strings.TrimSpace(in.Login)
	in.Email = strings.TrimSpace(strings.ToLower(in.Email))
	if len(in.Login) < 2 || len(in.Password) < 6 || !strings.Contains(in.Email, "@") {
		jsonErr(w, http.StatusBadRequest, "invalid fields")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "hash error")
		return
	}
	u, err := db.CreateUser(s.DB, in.Login, in.Email, string(hash), "user")
	if err != nil {
		jsonErr(w, http.StatusConflict, "login or email taken")
		return
	}
	token, err := auth.SignJWT(s.JWTSecret, u.ID, u.Role, s.JWTTTL)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "token error")
		return
	}
	jsonOK(w, map[string]any{"token": token, "user": publicUser(u)})
}

func (s *Server) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in loginReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	in.Login = strings.TrimSpace(in.Login)
	u, err := db.GetUserByLogin(s.DB, in.Login)
	if err != nil {
		jsonErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if u.Disabled {
		jsonErr(w, http.StatusForbidden, "account disabled")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(in.Password)) != nil {
		jsonErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	token, err := auth.SignJWT(s.JWTSecret, u.ID, u.Role, s.JWTTTL)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "token error")
		return
	}
	jsonOK(w, map[string]any{"token": token, "user": publicUser(u)})
}

func (s *Server) Me(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id, ok := UserID(r)
	if !ok {
		jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	u, err := db.GetUserByID(s.DB, id)
	if err != nil || u.Disabled {
		jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	jsonOK(w, publicUser(u))
}

func publicUser(u *db.User) map[string]any {
	return map[string]any{
		"id": u.ID, "login": u.Login, "email": u.Email, "role": u.Role,
		"disabled": u.Disabled, "created_at": u.CreatedAt.Format(time.RFC3339),
	}
}

func (s *Server) AdminListUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	list, err := db.ListUsers(s.DB)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	out := make([]map[string]any, 0, len(list))
	for i := range list {
		out = append(out, publicUser(&list[i]))
	}
	jsonOK(w, map[string]any{"users": out})
}

func (s *Server) AdminCreateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in createUserReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	in.Login = strings.TrimSpace(in.Login)
	in.Email = strings.TrimSpace(strings.ToLower(in.Email))
	in.Role = strings.TrimSpace(in.Role)
	if in.Role != "user" && in.Role != "admin" {
		in.Role = "user"
	}
	if len(in.Login) < 2 || len(in.Password) < 4 || !strings.Contains(in.Email, "@") {
		jsonErr(w, http.StatusBadRequest, "invalid fields (password min 4 for test accounts)")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "hash error")
		return
	}
	u, err := db.CreateUser(s.DB, in.Login, in.Email, string(hash), in.Role)
	if err != nil {
		jsonErr(w, http.StatusConflict, "login or email taken")
		return
	}
	jsonOK(w, map[string]any{"user": publicUser(u)})
}

func (s *Server) AdminPatchUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	idStr := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	idStr = strings.TrimSuffix(idStr, "/")
	idStr = strings.Split(idStr, "/")[0]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var in patchUserReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	u, err := db.UpdateUser(s.DB, id, in.Disabled, in.Role)
	if err != nil {
		jsonErr(w, http.StatusNotFound, "not found")
		return
	}
	jsonOK(w, map[string]any{"user": publicUser(u)})
}

func (s *Server) AdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	idStr := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	idStr = strings.TrimSuffix(idStr, "/")
	idStr = strings.Split(idStr, "/")[0]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "bad id")
		return
	}
	selfID, _ := UserID(r)
	if id == selfID {
		jsonErr(w, http.StatusBadRequest, "cannot delete self")
		return
	}
	if err := db.DeleteUser(s.DB, id); err != nil {
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) Health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err := s.DB.Ping(); err != nil {
		jsonErr(w, http.StatusServiceUnavailable, "db unavailable")
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func CORS(allowed string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			o := allowed
			if o == "" {
				o = "*"
			}
			w.Header().Set("Access-Control-Allow-Origin", o)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Max-Age", "86400")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func SeedAdmin(d *db.Database) error {
	n, err := db.CountUsers(d)
	if err != nil || n > 0 {
		return err
	}
	login := os.Getenv("ADMIN_LOGIN")
	if login == "" {
		login = "admin"
	}
	pass := os.Getenv("ADMIN_PASSWORD")
	if pass == "" {
		pass = "admin123"
	}
	email := os.Getenv("ADMIN_EMAIL")
	if email == "" {
		email = "admin@oldwhale.local"
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = db.CreateUser(d, login, email, string(hash), "admin")
	return err
}
