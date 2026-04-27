package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/oldwhale/backend/internal/db"
)

func isUniqueViolation(err error) bool {
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return true
	}
	return strings.Contains(err.Error(), "23505")
}

func (s *Server) PublicAIModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	groups, variants, err := db.ListAICatalogPublic(s.DB)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	out := make([]map[string]any, 0, len(groups))
	for i := range groups {
		g := groups[i]
		vlist := variants[i]
		vout := make([]map[string]any, 0, len(vlist))
		for j := range vlist {
			v := vlist[j]
			vout = append(vout, map[string]any{
				"id":         v.ID,
				"slug":       v.Slug,
				"label":      v.Label,
				"is_default": v.IsDefault,
			})
		}
		out = append(out, map[string]any{
			"id":        g.ID,
			"slug":      g.Slug,
			"label":     g.Label,
			"role":      g.Role,
			"color":     g.Color,
			"free":      g.Free,
			"variants":  vout,
		})
	}
	jsonOK(w, map[string]any{"groups": out})
}

func (s *Server) AdminListAIGroups(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	groups, variants, err := db.ListAICatalogAdmin(s.DB)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	out := make([]map[string]any, 0, len(groups))
	for i := range groups {
		g := groups[i]
		vlist := variants[i]
		vout := make([]map[string]any, 0, len(vlist))
		for j := range vlist {
			v := vlist[j]
			vout = append(vout, map[string]any{
				"id":          v.ID,
				"group_id":    v.GroupID,
				"slug":        v.Slug,
				"label":       v.Label,
				"is_default":  v.IsDefault,
				"position":    v.Position,
				"created_at":  v.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			})
		}
		out = append(out, map[string]any{
			"id":         g.ID,
			"slug":       g.Slug,
			"label":      g.Label,
			"role":       g.Role,
			"color":      g.Color,
			"free":       g.Free,
			"apiKey":     g.APIKey,
			"position":   g.Position,
			"created_at": g.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			"variants":   vout,
		})
	}
	jsonOK(w, map[string]any{"groups": out})
}

type aiCreateGroupReq struct {
	Slug     string  `json:"slug"`
	Label    string  `json:"label"`
	Role     string  `json:"role"`
	Color    string  `json:"color"`
	Free     *bool   `json:"free"`
	Position *int    `json:"position"`
	ApiKey   *string `json:"apiKey,omitempty"`
}

type aiPatchGroupReq struct {
	Slug     *string `json:"slug"`
	Label    *string `json:"label"`
	Role     *string `json:"role"`
	Color    *string `json:"color"`
	Free     *bool   `json:"free"`
	Position *int    `json:"position"`
	ApiKey   *string `json:"apiKey,omitempty"`
}

type aiReorderReq struct {
	IDs []int64 `json:"ids"`
}

type aiCreateVariantReq struct {
	Slug       string `json:"slug"`
	Label      string `json:"label"`
	IsDefault  *bool  `json:"is_default"`
	Position   *int   `json:"position"`
}

type aiPatchVariantReq struct {
	Slug       *string `json:"slug"`
	Label      *string `json:"label"`
	IsDefault  *bool   `json:"is_default"`
	Position   *int    `json:"position"`
}

func (s *Server) AdminCreateAIGroup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in aiCreateGroupReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	slug, err := db.ValidateAIModelSlug(in.Slug)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid slug")
		return
	}
	in.Label = strings.TrimSpace(in.Label)
	if in.Label == "" {
		jsonErr(w, http.StatusBadRequest, "label required")
		return
	}
	color, err := db.ValidateAIColor(in.Color)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid color")
		return
	}
	free := false
	if in.Free != nil {
		free = *in.Free
	}
	apiKey := ""
	if in.ApiKey != nil {
		apiKey = strings.TrimSpace(*in.ApiKey)
	}
	g, err := db.CreateAIGroup(s.DB, slug, in.Label, strings.TrimSpace(in.Role), color, free, in.Position, apiKey)
	if err != nil {
		if isUniqueViolation(err) {
			jsonErr(w, http.StatusConflict, "slug taken")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	jsonOK(w, map[string]any{"group": publicAIGroup(g, nil)})
}

func publicAIGroup(g *db.AIModelGroup, variants []map[string]any) map[string]any {
	m := map[string]any{
		"id":         g.ID,
		"slug":       g.Slug,
		"label":      g.Label,
		"role":       g.Role,
		"color":      g.Color,
		"free":       g.Free,
		"apiKey":     g.APIKey,
		"position":   g.Position,
		"created_at": g.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
	if variants != nil {
		m["variants"] = variants
	}
	return m
}

func (s *Server) AdminPatchAIGroup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id, ok := parsePathID(r.URL.Path, "/api/admin/ai/groups/")
	if !ok {
		jsonErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var in aiPatchGroupReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var slug, label, role, color *string
	if in.Slug != nil {
		sl, err := db.ValidateAIModelSlug(*in.Slug)
		if err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid slug")
			return
		}
		slug = &sl
	}
	if in.Label != nil {
		t := strings.TrimSpace(*in.Label)
		if t == "" {
			jsonErr(w, http.StatusBadRequest, "label empty")
			return
		}
		label = &t
	}
	if in.Role != nil {
		t := strings.TrimSpace(*in.Role)
		role = &t
	}
	if in.Color != nil {
		c, err := db.ValidateAIColor(*in.Color)
		if err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid color")
			return
		}
		color = &c
	}
	var apiKey *string
	if in.ApiKey != nil {
		t := strings.TrimSpace(*in.ApiKey)
		apiKey = &t
	}
	g, err := db.UpdateAIGroup(s.DB, id, slug, label, role, color, in.Free, in.Position, apiKey)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			jsonErr(w, http.StatusNotFound, "not found")
			return
		}
		if isUniqueViolation(err) {
			jsonErr(w, http.StatusConflict, "slug taken")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	jsonOK(w, map[string]any{"group": publicAIGroup(g, nil)})
}

func (s *Server) AdminDeleteAIGroup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id, ok := parsePathID(r.URL.Path, "/api/admin/ai/groups/")
	if !ok {
		jsonErr(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := db.DeleteAIGroup(s.DB, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			jsonErr(w, http.StatusNotFound, "not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) AdminReorderAIGroups(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in aiReorderReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(in.IDs) == 0 {
		jsonErr(w, http.StatusBadRequest, "ids required")
		return
	}
	if err := db.ReorderAIGroups(s.DB, in.IDs); err != nil {
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) AdminCreateAIVariant(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	const pfx = "/api/admin/ai/groups/"
	if !strings.HasPrefix(r.URL.Path, pfx) || !strings.HasSuffix(r.URL.Path, "/variants") {
		jsonErr(w, http.StatusBadRequest, "bad path")
		return
	}
	mid := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, pfx), "/variants")
	mid = strings.TrimSuffix(mid, "/")
	gid, err := strconv.ParseInt(mid, 10, 64)
	if err != nil || gid < 1 {
		jsonErr(w, http.StatusBadRequest, "bad group id")
		return
	}
	var in aiCreateVariantReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	slug, err := db.ValidateAIModelSlug(in.Slug)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid slug")
		return
	}
	def := false
	if in.IsDefault != nil {
		def = *in.IsDefault
	}
	v, err := db.CreateAIVariant(s.DB, gid, slug, in.Label, def, in.Position)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			jsonErr(w, http.StatusNotFound, "group not found")
			return
		}
		if isUniqueViolation(err) {
			jsonErr(w, http.StatusConflict, "slug taken")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	jsonOK(w, map[string]any{"variant": publicAIVariant(v)})
}

func publicAIVariant(v *db.AIModelVariant) map[string]any {
	return map[string]any{
		"id":          v.ID,
		"group_id":    v.GroupID,
		"slug":        v.Slug,
		"label":       v.Label,
		"is_default":  v.IsDefault,
		"position":    v.Position,
		"created_at":  v.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func (s *Server) AdminReorderAIVariants(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	const pfx = "/api/admin/ai/groups/"
	const suf = "/variants/order"
	if !strings.HasPrefix(r.URL.Path, pfx) || !strings.HasSuffix(r.URL.Path, suf) {
		jsonErr(w, http.StatusBadRequest, "bad path")
		return
	}
	mid := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, pfx), suf)
	mid = strings.TrimSuffix(mid, "/")
	gid, err := strconv.ParseInt(mid, 10, 64)
	if err != nil || gid < 1 {
		jsonErr(w, http.StatusBadRequest, "bad group id")
		return
	}
	var in aiReorderReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(in.IDs) == 0 {
		jsonErr(w, http.StatusBadRequest, "ids required")
		return
	}
	if err := db.ReorderAIVariants(s.DB, gid, in.IDs); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid reorder")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) AdminPatchAIVariant(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id, ok := parsePathID(r.URL.Path, "/api/admin/ai/variants/")
	if !ok {
		jsonErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var in aiPatchVariantReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var slug, label *string
	if in.Slug != nil {
		sl, err := db.ValidateAIModelSlug(*in.Slug)
		if err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid slug")
			return
		}
		slug = &sl
	}
	if in.Label != nil {
		label = in.Label
	}
	v, err := db.UpdateAIVariant(s.DB, id, slug, label, in.IsDefault, in.Position)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			jsonErr(w, http.StatusNotFound, "not found")
			return
		}
		if isUniqueViolation(err) {
			jsonErr(w, http.StatusConflict, "slug taken")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	jsonOK(w, map[string]any{"variant": publicAIVariant(v)})
}

func (s *Server) AdminDeleteAIVariant(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		jsonErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id, ok := parsePathID(r.URL.Path, "/api/admin/ai/variants/")
	if !ok {
		jsonErr(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := db.DeleteAIVariant(s.DB, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			jsonErr(w, http.StatusNotFound, "not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// parsePathID extracts int64 after prefix, path must be /prefix{id} or /prefix{id}/...
func parsePathID(path, prefix string) (int64, bool) {
	if !strings.HasPrefix(path, prefix) {
		return 0, false
	}
	rest := strings.TrimPrefix(path, prefix)
	rest = strings.TrimSuffix(rest, "/")
	part := rest
	if i := strings.IndexByte(rest, '/'); i >= 0 {
		part = rest[:i]
	}
	if part == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(part, 10, 64)
	if err != nil || id < 1 {
		return 0, false
	}
	return id, true
}
