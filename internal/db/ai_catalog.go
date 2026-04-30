package db

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// AIModelGroup is a provider bucket (was `AIM` in the frontend).
type AIModelGroup struct {
	ID        int64     `json:"id"`
	Slug      string    `json:"slug"`
	Label     string    `json:"label"`
	Role      string    `json:"role"`
	Color     string    `json:"color"`
	Free      bool      `json:"free"`
	Position  int       `json:"position"`
	APIKey    string    `json:"apiKey,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// AIModelVariant is a concrete model under a group (was `AI_MODEL_VARIANTS[group]`).
type AIModelVariant struct {
	ID        int64     `json:"id"`
	GroupID   int64     `json:"group_id"`
	Slug      string    `json:"slug"`
	Label     string    `json:"label"`
	IsDefault bool      `json:"is_default"`
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"created_at"`
}

func (d *Database) migrateAICatalog() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS ai_model_groups (
	id BIGSERIAL PRIMARY KEY,
	slug TEXT NOT NULL UNIQUE,
	label TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT '',
	color TEXT NOT NULL DEFAULT '',
	free INTEGER NOT NULL DEFAULT 0,
	position INTEGER NOT NULL DEFAULT 0,
	api_key TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL
)`,
		`CREATE TABLE IF NOT EXISTS ai_model_variants (
	id BIGSERIAL PRIMARY KEY,
	group_id BIGINT NOT NULL REFERENCES ai_model_groups(id) ON DELETE CASCADE,
	slug TEXT NOT NULL,
	label TEXT NOT NULL DEFAULT '',
	is_default INTEGER NOT NULL DEFAULT 0,
	position INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	UNIQUE (group_id, slug)
)`,
		`CREATE INDEX IF NOT EXISTS idx_aiv_group ON ai_model_variants(group_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_aiv_default_per_group ON ai_model_variants(group_id) WHERE is_default = 1`,
	}
	for _, s := range stmts {
		if _, err := d.Exec(s); err != nil {
			return err
		}
	}
	if _, err := d.Exec(`ALTER TABLE ai_model_groups ADD COLUMN IF NOT EXISTS api_key TEXT NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	return nil
}

// CountAIGroups returns how many rows exist in ai_model_groups.
func CountAIGroups(d *Database) (int, error) {
	var n int
	err := d.QueryRow(`SELECT COUNT(*) FROM ai_model_groups`).Scan(&n)
	return n, err
}

// SeedAICatalog inserts the legacy AIM + AI_MODEL_VARIANTS catalog when the table is empty.
func SeedAICatalog(d *Database) error {
	n, err := CountAIGroups(d)
	if err != nil || n > 0 {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	type g struct {
		slug, label, role, color string
		free                     int
		pos                      int
	}
	type v struct {
		slug, label string
		def         bool
		pos         int
	}
	groups := []g{
		{"deepseek", "DeepSeek", "Черновик", "#4ade80", 1, 0},
		{"claude", "Claude", "Редактура", "#7c6af7", 0, 1},
		{"gpt", "GPT", "Идеи", "#f472b6", 0, 2},
		{"grok", "Grok", "Идеи", "#f59e0b", 0, 3},
		{"gemini", "Gemini", "Идеи", "#60a5fa", 0, 4},
	}
	variants := map[string][]v{
		"claude": {
			{"claude-opus-4-6", "Opus 4.6", true, 0},
			{"claude-sonnet-4-6", "Sonnet 4.6", false, 1},
			{"claude-haiku-4-5", "Haiku 4.5", false, 2},
		},
		"deepseek": {
			{"deepseek-v3-2", "V3.2", true, 0},
			{"deepseek-chat", "", false, 1},
			{"deepseek-v3-2-exp", "V3.2-Exp", false, 2},
			{"deepseek-v4", "V4", false, 3},
		},
		"gpt": {
			{"gpt-5-4-thinking", "GPT-5.4 Thinking", true, 0},
			{"gpt-5-4-pro", "GPT-5.4 Pro", false, 1},
			{"gpt-5-4-mini", "GPT-5.4 mini", false, 2},
		},
		"gemini": {
			{"gemini-3-flash", "Gemini-3-Flash", true, 0},
			{"gemini-3-pro", "Gemini-3-Pro", false, 1},
			{"gemini-1-5-pro", "Gemini-1.5-Pro", false, 2},
		},
		"grok": {
			{"grok-4-20", "Grok 4.20", true, 0},
			{"grok-4-1-fast", "Grok 4.1 Fast", false, 1},
			{"grok-4-1-fast-nr", "Grok 4.1 Fast NR", false, 2},
		},
	}
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, gr := range groups {
		var gid int64
		err := tx.QueryRow(
			`INSERT INTO ai_model_groups(slug,label,role,color,free,position,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
			gr.slug, gr.label, gr.role, gr.color, gr.free, gr.pos, now,
		).Scan(&gid)
		if err != nil {
			return err
		}
		for _, vv := range variants[gr.slug] {
			def := 0
			if vv.def {
				def = 1
			}
			_, err := tx.Exec(
				`INSERT INTO ai_model_variants(group_id,slug,label,is_default,position,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
				gid, vv.slug, vv.label, def, vv.pos, now,
			)
			if err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// ListAICatalogPublic returns groups with nested variants for GET /api/ai/models.
func ListAICatalogPublic(d *Database) ([]AIModelGroup, [][]AIModelVariant, error) {
	rows, err := d.Query(`
SELECT g.id,g.slug,g.label,g.role,g.color,g.free,g.position,g.api_key,g.created_at,
	v.id,v.slug,v.label,v.is_default,v.position,v.created_at
FROM ai_model_groups g
LEFT JOIN ai_model_variants v ON v.group_id = g.id
ORDER BY g.position, g.id, v.position, v.id`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	return scanCatalogJoinedRows(rows)
}

// ListAICatalogAdmin returns the same shape for admin UI (full variant rows).
func ListAICatalogAdmin(d *Database) ([]AIModelGroup, [][]AIModelVariant, error) {
	return ListAICatalogPublic(d)
}

func scanCatalogJoinedRows(rows *sql.Rows) ([]AIModelGroup, [][]AIModelVariant, error) {
	var groups []AIModelGroup
	var allVariants [][]AIModelVariant
	seen := make(map[int64]int) // group id -> index in groups

	for rows.Next() {
		var g AIModelGroup
		var gCreated string
		var gFree int
		var vid sql.NullInt64
		var vslug, vlabel sql.NullString
		var vdef sql.NullInt64
		var vpos sql.NullInt64
		var vcreated sql.NullString
		err := rows.Scan(
			&g.ID, &g.Slug, &g.Label, &g.Role, &g.Color, &gFree, &g.Position, &g.APIKey, &gCreated,
			&vid, &vslug, &vlabel, &vdef, &vpos, &vcreated,
		)
		if err != nil {
			return nil, nil, err
		}
		g.Free = gFree != 0
		g.CreatedAt, _ = time.Parse(time.RFC3339, gCreated)
		idx, ok := seen[g.ID]
		if !ok {
			seen[g.ID] = len(groups)
			groups = append(groups, g)
			allVariants = append(allVariants, nil)
			idx = len(groups) - 1
		} else {
			groups[idx] = g // refresh scan (same group repeated for each variant row)
		}
		if vid.Valid {
			v := AIModelVariant{
				ID:        vid.Int64,
				GroupID:   g.ID,
				Slug:      vslug.String,
				Label:     vlabel.String,
				IsDefault: vdef.Int64 != 0,
				Position:  int(vpos.Int64),
			}
			if vcreated.Valid {
				v.CreatedAt, _ = time.Parse(time.RFC3339, vcreated.String)
			}
			allVariants[idx] = append(allVariants[idx], v)
		}
	}
	return groups, allVariants, rows.Err()
}

// GetAIGroupByID returns one group or sql.ErrNoRows.
func GetAIGroupByID(d *Database, id int64) (*AIModelGroup, error) {
	row := d.QueryRow(
		`SELECT id,slug,label,role,color,free,position,api_key,created_at FROM ai_model_groups WHERE id=$1`,
		id,
	)
	return scanAIGroupRow(row)
}

// GetAIGroupBySlug returns one group or sql.ErrNoRows.
func GetAIGroupBySlug(d *Database, slug string) (*AIModelGroup, error) {
	row := d.QueryRow(
		`SELECT id,slug,label,role,color,free,position,api_key,created_at FROM ai_model_groups WHERE slug=$1`,
		slug,
	)
	return scanAIGroupRow(row)
}

func scanAIGroupRow(row scanner) (*AIModelGroup, error) {
	var g AIModelGroup
	var created string
	var free int
	err := row.Scan(&g.ID, &g.Slug, &g.Label, &g.Role, &g.Color, &free, &g.Position, &g.APIKey, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	g.Free = free != 0
	g.CreatedAt, _ = time.Parse(time.RFC3339, created)
	return &g, nil
}

// CreateAIGroup inserts a new group.
func CreateAIGroup(d *Database, slug, label, role, color string, free bool, position *int, apiKey string) (*AIModelGroup, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	pos := 0
	if position != nil {
		pos = *position
	} else {
		_ = d.QueryRow(`SELECT COALESCE(MAX(position),0)+1 FROM ai_model_groups`).Scan(&pos)
	}
	fr := 0
	if free {
		fr = 1
	}
	var id int64
	err := d.QueryRow(
		`INSERT INTO ai_model_groups(slug,label,role,color,free,position,api_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
		slug, label, role, color, fr, pos, apiKey, now,
	).Scan(&id)
	if err != nil {
		return nil, err
	}
	return GetAIGroupByID(d, id)
}

// UpdateAIGroup applies non-nil fields.
func UpdateAIGroup(d *Database, id int64, slug, label, role, color *string, free *bool, position *int, apiKey *string) (*AIModelGroup, error) {
	if _, err := GetAIGroupByID(d, id); err != nil {
		return nil, err
	}
	if slug != nil {
		if _, err := d.Exec(`UPDATE ai_model_groups SET slug=$1 WHERE id=$2`, *slug, id); err != nil {
			return nil, err
		}
	}
	if label != nil {
		if _, err := d.Exec(`UPDATE ai_model_groups SET label=$1 WHERE id=$2`, *label, id); err != nil {
			return nil, err
		}
	}
	if role != nil {
		if _, err := d.Exec(`UPDATE ai_model_groups SET role=$1 WHERE id=$2`, *role, id); err != nil {
			return nil, err
		}
	}
	if color != nil {
		if _, err := d.Exec(`UPDATE ai_model_groups SET color=$1 WHERE id=$2`, *color, id); err != nil {
			return nil, err
		}
	}
	if free != nil {
		fr := 0
		if *free {
			fr = 1
		}
		if _, err := d.Exec(`UPDATE ai_model_groups SET free=$1 WHERE id=$2`, fr, id); err != nil {
			return nil, err
		}
	}
	if position != nil {
		if _, err := d.Exec(`UPDATE ai_model_groups SET position=$1 WHERE id=$2`, *position, id); err != nil {
			return nil, err
		}
	}
	if apiKey != nil {
		if _, err := d.Exec(`UPDATE ai_model_groups SET api_key=$1 WHERE id=$2`, *apiKey, id); err != nil {
			return nil, err
		}
	}
	return GetAIGroupByID(d, id)
}

// DeleteAIGroup removes a group (cascade variants).
func DeleteAIGroup(d *Database, id int64) error {
	res, err := d.Exec(`DELETE FROM ai_model_groups WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ReorderAIGroups sets position 0..n-1 for the given ids in order.
func ReorderAIGroups(d *Database, ids []int64) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for i, id := range ids {
		if _, err := tx.Exec(`UPDATE ai_model_groups SET position=$1 WHERE id=$2`, i, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// CreateAIVariant inserts a variant; if isDefault, clears siblings in same tx.
func CreateAIVariant(d *Database, groupID int64, slug, label string, isDefault bool, position *int) (*AIModelVariant, error) {
	if _, err := GetAIGroupByID(d, groupID); err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	pos := 0
	if position != nil {
		pos = *position
	} else {
		_ = d.QueryRow(`SELECT COALESCE(MAX(position),0)+1 FROM ai_model_variants WHERE group_id=$1`, groupID).Scan(&pos)
	}
	tx, err := d.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if isDefault {
		if _, err := tx.Exec(`UPDATE ai_model_variants SET is_default=0 WHERE group_id=$1`, groupID); err != nil {
			return nil, err
		}
	}
	def := 0
	if isDefault {
		def = 1
	}
	var id int64
	err = tx.QueryRow(
		`INSERT INTO ai_model_variants(group_id,slug,label,is_default,position,created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		groupID, slug, label, def, pos, now,
	).Scan(&id)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return GetAIVariantByID(d, id)
}

// AIImportedVariant is a provider model normalized for storage under an AI group.
type AIImportedVariant struct {
	Slug  string
	Label string
}

// ListAIVariantsByGroup returns variants for one group ordered for admin display.
func ListAIVariantsByGroup(d *Database, groupID int64) ([]AIModelVariant, error) {
	rows, err := d.Query(
		`SELECT id,group_id,slug,label,is_default,position,created_at
FROM ai_model_variants
WHERE group_id=$1
ORDER BY position,id`,
		groupID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AIModelVariant
	for rows.Next() {
		v, err := scanAIVariantRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

// UpsertAIVariants imports provider models without deleting existing curated variants.
func UpsertAIVariants(d *Database, groupID int64, variants []AIImportedVariant) ([]AIModelVariant, error) {
	if _, err := GetAIGroupByID(d, groupID); err != nil {
		return nil, err
	}
	tx, err := d.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var defaultCount int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM ai_model_variants WHERE group_id=$1 AND is_default=1`, groupID).Scan(&defaultCount); err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	for i, v := range variants {
		slug, err := ValidateAIModelSlug(v.Slug)
		if err != nil {
			return nil, err
		}
		label := strings.TrimSpace(v.Label)
		def := 0
		if defaultCount == 0 && i == 0 {
			def = 1
		}
		if _, err := tx.Exec(
			`INSERT INTO ai_model_variants(group_id,slug,label,is_default,position,created_at)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (group_id,slug) DO UPDATE SET label=EXCLUDED.label, position=EXCLUDED.position`,
			groupID,
			slug,
			label,
			def,
			i,
			now,
		); err != nil {
			return nil, err
		}
	}
	if defaultCount == 0 && len(variants) > 0 {
		firstSlug, err := ValidateAIModelSlug(variants[0].Slug)
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(`UPDATE ai_model_variants SET is_default=1 WHERE group_id=$1 AND slug=$2`, groupID, firstSlug); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return ListAIVariantsByGroup(d, groupID)
}

// GetAIVariantByID returns variant + group_id.
func GetAIVariantByID(d *Database, id int64) (*AIModelVariant, error) {
	row := d.QueryRow(
		`SELECT id,group_id,slug,label,is_default,position,created_at FROM ai_model_variants WHERE id=$1`,
		id,
	)
	return scanAIVariantRow(row)
}

func scanAIVariantRow(row scanner) (*AIModelVariant, error) {
	var v AIModelVariant
	var def int
	var created string
	err := row.Scan(&v.ID, &v.GroupID, &v.Slug, &v.Label, &def, &v.Position, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	v.IsDefault = def != 0
	v.CreatedAt, _ = time.Parse(time.RFC3339, created)
	return &v, nil
}

// UpdateAIVariant patches fields; is_default true clears siblings.
func UpdateAIVariant(d *Database, id int64, slug, label *string, isDefault *bool, position *int) (*AIModelVariant, error) {
	v0, err := GetAIVariantByID(d, id)
	if err != nil {
		return nil, err
	}
	tx, err := d.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if isDefault != nil && *isDefault {
		if _, err := tx.Exec(`UPDATE ai_model_variants SET is_default=0 WHERE group_id=$1`, v0.GroupID); err != nil {
			return nil, err
		}
	}
	if slug != nil {
		if _, err := tx.Exec(`UPDATE ai_model_variants SET slug=$1 WHERE id=$2`, *slug, id); err != nil {
			return nil, err
		}
	}
	if label != nil {
		if _, err := tx.Exec(`UPDATE ai_model_variants SET label=$1 WHERE id=$2`, *label, id); err != nil {
			return nil, err
		}
	}
	if isDefault != nil {
		def := 0
		if *isDefault {
			def = 1
		}
		if _, err := tx.Exec(`UPDATE ai_model_variants SET is_default=$1 WHERE id=$2`, def, id); err != nil {
			return nil, err
		}
	}
	if position != nil {
		if _, err := tx.Exec(`UPDATE ai_model_variants SET position=$1 WHERE id=$2`, *position, id); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return GetAIVariantByID(d, id)
}

// DeleteAIVariant removes one variant.
func DeleteAIVariant(d *Database, id int64) error {
	res, err := d.Exec(`DELETE FROM ai_model_variants WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ReorderAIVariants sets positions for variants in one group.
func ReorderAIVariants(d *Database, groupID int64, ids []int64) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for i, id := range ids {
		var gid int64
		err := tx.QueryRow(`SELECT group_id FROM ai_model_variants WHERE id=$1`, id).Scan(&gid)
		if err != nil {
			return err
		}
		if gid != groupID {
			return fmt.Errorf("variant %d not in group %d", id, groupID)
		}
		if _, err := tx.Exec(`UPDATE ai_model_variants SET position=$1 WHERE id=$2`, i, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// SetAIDefaultVariant sets is_default=1 for id and 0 for siblings.
func SetAIDefaultVariant(d *Database, id int64) (*AIModelVariant, error) {
	v0, err := GetAIVariantByID(d, id)
	if err != nil {
		return nil, err
	}
	tx, err := d.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`UPDATE ai_model_variants SET is_default=0 WHERE group_id=$1`, v0.GroupID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`UPDATE ai_model_variants SET is_default=1 WHERE id=$1`, id); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return GetAIVariantByID(d, id)
}

// ErrSlugInvalid is returned when slug does not match [a-z0-9][a-z0-9-]*.
var ErrSlugInvalid = errors.New("invalid slug")

// ValidateAIModelSlug trims and checks format.
func ValidateAIModelSlug(s string) (string, error) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" || !isValidAIModelSlug(s) {
		return "", ErrSlugInvalid
	}
	return s, nil
}

func isValidAIModelSlug(s string) bool {
	if len(s) == 0 {
		return false
	}
	c0 := s[0]
	if c0 < 'a' || c0 > 'z' {
		if c0 < '0' || c0 > '9' {
			return false
		}
	}
	for i := 1; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' {
			continue
		}
		return false
	}
	return true
}

// ValidateAIColor returns trimmed color or error if non-empty and invalid.
func ValidateAIColor(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", nil
	}
	if len(s) != 4 && len(s) != 5 && len(s) != 7 && len(s) != 9 {
		return "", errors.New("invalid color")
	}
	if s[0] != '#' {
		return "", errors.New("invalid color")
	}
	for i := 1; i < len(s); i++ {
		c := s[i]
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F') {
			continue
		}
		return "", errors.New("invalid color")
	}
	return s, nil
}
