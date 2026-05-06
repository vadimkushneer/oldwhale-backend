package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dbgen "github.com/oldwhale/backend/internal/db/generated"
	"github.com/oldwhale/backend/internal/domain"
)

const maxAdminModelsURLLen = 2048
const maxAdminModelsResponseBytes = 4 << 20

type AICatalogService struct {
	q          dbgen.Querier
	secrets    *SecretsService
	httpClient *http.Client
}

func NewAICatalogService(q dbgen.Querier, secrets *SecretsService) *AICatalogService {
	return &AICatalogService{
		q:       q,
		secrets: secrets,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

type CreateGroupInput struct {
	Slug         string
	Label        string
	Role         string
	Color        string
	Free         bool
	Position     *int
	APIKeyEnvVar string
}

type PatchGroupInput struct {
	Slug         *string
	Label        *string
	Role         *string
	Color        *string
	Free         *bool
	Position     *int
	APIKeyEnvVar *string
}

type CreateVariantInput struct {
	GroupUID          uuid.UUID
	Slug              string
	ProviderModelID   string
	Label             string
	IsDefault         bool
	Position          *int
}

type PatchVariantInput struct {
	Slug              *string
	ProviderModelID   *string
	Label             *string
	IsDefault         *bool
	Position          *int
}

type AdminGroupView struct {
	Group         domain.AIModelGroup
	APIKeyPresent bool
}

func (s *AICatalogService) CreateGroup(ctx context.Context, in CreateGroupInput) (domain.AIModelGroup, error) {
	slug, err := domain.ValidateSlug(in.Slug)
	if err != nil {
		return domain.AIModelGroup{}, err
	}
	label := strings.TrimSpace(in.Label)
	if label == "" {
		return domain.AIModelGroup{}, domain.ErrLabelRequired
	}
	color, err := domain.ValidateColor(in.Color)
	if err != nil {
		return domain.AIModelGroup{}, err
	}
	envVar, err := domain.ValidateEnvVarName(in.APIKeyEnvVar)
	if err != nil {
		return domain.AIModelGroup{}, err
	}
	position := int32(0)
	if in.Position != nil {
		position = int32(*in.Position)
	} else {
		groups, _ := s.q.ListAIGroupsAdmin(ctx)
		position = int32(len(groups))
	}
	g, err := s.q.CreateAIGroup(ctx, dbgen.CreateAIGroupParams{
		Uid:          domain.NewUID(),
		Slug:         slug,
		Label:        label,
		Role:         strings.TrimSpace(in.Role),
		Color:        color,
		Free:         in.Free,
		Position:     position,
		ApiKeyEnvVar: envVar,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return domain.AIModelGroup{}, domain.ErrConflict
		}
		return domain.AIModelGroup{}, err
	}
	return dbGroupToDomain(g), nil
}

func (s *AICatalogService) PatchGroup(ctx context.Context, uid uuid.UUID, in PatchGroupInput) (domain.AIModelGroup, error) {
	var slug, label, role, color, envVar *string
	var pos *int32
	if in.Slug != nil {
		v, err := domain.ValidateSlug(*in.Slug)
		if err != nil {
			return domain.AIModelGroup{}, err
		}
		slug = &v
	}
	if in.Label != nil {
		v := strings.TrimSpace(*in.Label)
		if v == "" {
			return domain.AIModelGroup{}, domain.ErrLabelRequired
		}
		label = &v
	}
	if in.Role != nil {
		v := strings.TrimSpace(*in.Role)
		role = &v
	}
	if in.Color != nil {
		v, err := domain.ValidateColor(*in.Color)
		if err != nil {
			return domain.AIModelGroup{}, err
		}
		color = &v
	}
	if in.APIKeyEnvVar != nil {
		v, err := domain.ValidateEnvVarName(*in.APIKeyEnvVar)
		if err != nil {
			return domain.AIModelGroup{}, err
		}
		envVar = &v
	}
	if in.Position != nil {
		v := int32(*in.Position)
		pos = &v
	}
	g, err := s.q.PatchAIGroup(ctx, dbgen.PatchAIGroupParams{
		Uid:          uid,
		Slug:         slug,
		Label:        label,
		Role:         role,
		Color:        color,
		Free:         in.Free,
		Position:     pos,
		ApiKeyEnvVar: envVar,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return domain.AIModelGroup{}, domain.ErrConflict
		}
		return domain.AIModelGroup{}, mapNoRows(err)
	}
	return dbGroupToDomain(g), nil
}

func (s *AICatalogService) GetGroupByUID(ctx context.Context, uid uuid.UUID) (domain.AIModelGroup, error) {
	g, err := s.q.GetAIGroupByUID(ctx, uid)
	if err != nil {
		return domain.AIModelGroup{}, mapNoRows(err)
	}
	return dbGroupToDomain(g), nil
}

func (s *AICatalogService) GetGroupBySlug(ctx context.Context, slug string) (domain.AIModelGroup, error) {
	g, err := s.q.GetAIGroupBySlug(ctx, slug)
	if err != nil {
		return domain.AIModelGroup{}, mapNoRows(err)
	}
	return dbGroupToDomain(g), nil
}

func (s *AICatalogService) ListGroupsAdmin(ctx context.Context) ([]AdminGroupView, error) {
	groups, err := s.q.ListAIGroupsAdmin(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]AdminGroupView, 0, len(groups))
	for _, g := range groups {
		dg := dbGroupToDomain(g)
		variants, err := s.q.ListAIVariantsByGroup(ctx, g.Uid)
		if err != nil {
			return nil, err
		}
		for _, v := range variants {
			dg.Variants = append(dg.Variants, dbVariantToDomain(v))
		}
		out = append(out, s.GroupAdminView(dg))
	}
	return out, nil
}

func (s *AICatalogService) ListGroupsAdminIncludingDeleted(ctx context.Context) ([]AdminGroupView, error) {
	groups, err := s.q.ListAIGroupsAdminIncludingDeleted(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]AdminGroupView, 0, len(groups))
	for _, g := range groups {
		dg := dbGroupToDomain(g)
		variants, _ := s.q.ListAIVariantsByGroupIncludingDeleted(ctx, g.Uid)
		for _, v := range variants {
			dg.Variants = append(dg.Variants, dbVariantToDomain(v))
		}
		out = append(out, s.GroupAdminView(dg))
	}
	return out, nil
}

func (s *AICatalogService) ListPublicCatalog(ctx context.Context, includePaid bool) ([]domain.AIModelGroup, error) {
	rows, err := s.q.ListPublicCatalogJoined(ctx, includePaid)
	if err != nil {
		return nil, err
	}
	out := make([]domain.AIModelGroup, 0)
	index := map[uuid.UUID]int{}
	for _, row := range rows {
		i, ok := index[row.GroupModelUid]
		if !ok {
			g := domain.AIModelGroup{
				Meta:         domain.Meta{UID: row.GroupModelUid, CreatedAt: row.GroupModelCreatedAt, UpdatedAt: row.GroupModelUpdatedAt},
				Slug:         row.GroupModelSlug,
				Label:        row.GroupModelLabel,
				Role:         row.GroupModelRole,
				Color:        row.GroupModelColor,
				Free:         row.GroupModelFree,
				Position:     int(row.GroupModelPosition),
				APIKeyEnvVar: row.GroupModelApiKeyEnvVar,
				DeletedAt:    timePtr(row.GroupModelDeletedAt),
			}
			out = append(out, g)
			i = len(out) - 1
			index[row.GroupModelUid] = i
		}
		if row.VariantModelUid.Valid && row.VariantModelSlug != nil && row.VariantModelLabel != nil && row.VariantModelIsDefault != nil && row.VariantModelPosition != nil &&
			row.VariantModelProviderModelID != nil && strings.TrimSpace(*row.VariantModelProviderModelID) != "" {
			out[i].Variants = append(out[i].Variants, domain.AIModelVariant{
				Meta: domain.Meta{
					UID:       row.VariantModelUid.Bytes,
					CreatedAt: row.VariantModelCreatedAt.Time,
					UpdatedAt: row.VariantModelUpdatedAt.Time,
				},
				GroupUID:        row.GroupModelUid,
				Slug:            *row.VariantModelSlug,
				ProviderModelID: strings.TrimSpace(*row.VariantModelProviderModelID),
				Label:           *row.VariantModelLabel,
				IsDefault:       *row.VariantModelIsDefault,
				Position:        int(*row.VariantModelPosition),
				DeletedAt:       timePtr(row.VariantModelDeletedAt),
			})
		}
	}
	return out, nil
}

func (s *AICatalogService) SoftDeleteGroup(ctx context.Context, uid uuid.UUID) error {
	_, err := s.q.SoftDeleteAIGroup(ctx, uid)
	return mapNoRows(err)
}

func (s *AICatalogService) ReorderGroups(ctx context.Context, uids []uuid.UUID) error {
	if len(uids) == 0 {
		return domain.ErrInvalidInput
	}
	return s.q.ReorderAIGroups(ctx, uids)
}

func (s *AICatalogService) CreateVariant(ctx context.Context, in CreateVariantInput) (domain.AIModelVariant, error) {
	if _, err := s.q.GetAIGroupByUID(ctx, in.GroupUID); err != nil {
		return domain.AIModelVariant{}, mapNoRows(err)
	}
	slug, err := domain.ValidateSlug(in.Slug)
	if err != nil {
		return domain.AIModelVariant{}, err
	}
	providerModelID, err := domain.ValidateProviderModelID(in.ProviderModelID)
	if err != nil {
		return domain.AIModelVariant{}, err
	}
	position := int32(0)
	if in.Position != nil {
		position = int32(*in.Position)
	} else {
		variants, _ := s.q.ListAIVariantsByGroup(ctx, in.GroupUID)
		position = int32(len(variants))
	}
	v, err := s.q.CreateAIVariant(ctx, dbgen.CreateAIVariantParams{
		Uid:               domain.NewUID(),
		GroupUid:          in.GroupUID,
		Slug:              slug,
		ProviderModelID:   providerModelID,
		Label:             strings.TrimSpace(in.Label),
		IsDefault:         false,
		Position:          position,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return domain.AIModelVariant{}, domain.ErrConflict
		}
		return domain.AIModelVariant{}, err
	}
	if in.IsDefault {
		if _, err := s.q.SetDefaultAIVariant(ctx, dbgen.SetDefaultAIVariantParams{Uid: v.Uid, GroupUid: v.GroupUid}); err != nil {
			return domain.AIModelVariant{}, err
		}
		v, err = s.q.GetAIVariantByUID(ctx, v.Uid)
		if err != nil {
			return domain.AIModelVariant{}, err
		}
	}
	return dbVariantToDomain(v), nil
}

func (s *AICatalogService) PatchVariant(ctx context.Context, uid uuid.UUID, in PatchVariantInput) (domain.AIModelVariant, error) {
	current, err := s.q.GetAIVariantByUID(ctx, uid)
	if err != nil {
		return domain.AIModelVariant{}, mapNoRows(err)
	}
	var slug, label *string
	var providerModelID *string
	var pos *int32
	var isDefault *bool
	if in.Slug != nil {
		v, err := domain.ValidateSlug(*in.Slug)
		if err != nil {
			return domain.AIModelVariant{}, err
		}
		slug = &v
	}
	if in.ProviderModelID != nil {
		v, err := domain.ValidateProviderModelID(*in.ProviderModelID)
		if err != nil {
			return domain.AIModelVariant{}, err
		}
		providerModelID = &v
	}
	if in.Label != nil {
		v := strings.TrimSpace(*in.Label)
		label = &v
	}
	if in.Position != nil {
		v := int32(*in.Position)
		pos = &v
	}
	if in.IsDefault != nil && !*in.IsDefault {
		isDefault = in.IsDefault
	}
	v, err := s.q.PatchAIVariant(ctx, dbgen.PatchAIVariantParams{
		Uid:               uid,
		Slug:              slug,
		ProviderModelID:   providerModelID,
		Label:             label,
		IsDefault:         isDefault,
		Position:          pos,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return domain.AIModelVariant{}, domain.ErrConflict
		}
		return domain.AIModelVariant{}, mapNoRows(err)
	}
	if in.IsDefault != nil && *in.IsDefault {
		if _, err := s.q.SetDefaultAIVariant(ctx, dbgen.SetDefaultAIVariantParams{Uid: uid, GroupUid: current.GroupUid}); err != nil {
			return domain.AIModelVariant{}, err
		}
		v, err = s.q.GetAIVariantByUID(ctx, uid)
		if err != nil {
			return domain.AIModelVariant{}, err
		}
	}
	return dbVariantToDomain(v), nil
}

func (s *AICatalogService) SoftDeleteVariant(ctx context.Context, uid uuid.UUID) error {
	_, err := s.q.SoftDeleteAIVariant(ctx, uid)
	return mapNoRows(err)
}

func (s *AICatalogService) ReorderVariants(ctx context.Context, groupUID uuid.UUID, uids []uuid.UUID) error {
	if len(uids) == 0 {
		return domain.ErrInvalidInput
	}
	return s.q.ReorderAIVariants(ctx, dbgen.ReorderAIVariantsParams{GroupUid: groupUID, Uids: uids})
}

func (s *AICatalogService) SetDefaultVariant(ctx context.Context, uid uuid.UUID) (domain.AIModelVariant, error) {
	v, err := s.q.GetAIVariantByUID(ctx, uid)
	if err != nil {
		return domain.AIModelVariant{}, mapNoRows(err)
	}
	if _, err := s.q.SetDefaultAIVariant(ctx, dbgen.SetDefaultAIVariantParams{Uid: uid, GroupUid: v.GroupUid}); err != nil {
		return domain.AIModelVariant{}, err
	}
	v, err = s.q.GetAIVariantByUID(ctx, uid)
	if err != nil {
		return domain.AIModelVariant{}, err
	}
	return dbVariantToDomain(v), nil
}

func (s *AICatalogService) GroupAdminView(group domain.AIModelGroup) AdminGroupView {
	return AdminGroupView{Group: group, APIKeyPresent: s.secrets.IsResolvable(group.APIKeyEnvVar)}
}

type aiModelProviderAuthScheme string

const (
	aiModelProviderAuthAnthropic aiModelProviderAuthScheme = "anthropic"
	aiModelProviderAuthBearer    aiModelProviderAuthScheme = "bearer"
	aiModelProviderAuthGoogle    aiModelProviderAuthScheme = "google-api-key"
)

type aiModelProvider struct {
	ID         string
	Label      string
	ModelsURL  string
	AuthScheme aiModelProviderAuthScheme
}

var adminAIModelProviders = []aiModelProvider{
	{ID: "openai", Label: "OpenAI", ModelsURL: "https://api.openai.com/v1/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "anthropic", Label: "Anthropic Claude", ModelsURL: "https://api.anthropic.com/v1/models", AuthScheme: aiModelProviderAuthAnthropic},
	{ID: "google-gemini", Label: "Google Gemini", ModelsURL: "https://generativelanguage.googleapis.com/v1beta/models", AuthScheme: aiModelProviderAuthGoogle},
	{ID: "mistral", Label: "Mistral", ModelsURL: "https://api.mistral.ai/v1/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "cohere", Label: "Cohere", ModelsURL: "https://api.cohere.com/v1/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "together-ai", Label: "Together AI", ModelsURL: "https://api.together.xyz/v1/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "groq", Label: "Groq", ModelsURL: "https://api.groq.com/openai/v1/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "fireworks", Label: "Fireworks", ModelsURL: "https://api.fireworks.ai/inference/v1/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "perplexity", Label: "Perplexity", ModelsURL: "https://api.perplexity.ai/models", AuthScheme: aiModelProviderAuthBearer},
	{ID: "deepseek", Label: "DeepSeek", ModelsURL: "https://api.deepseek.com/models", AuthScheme: aiModelProviderAuthBearer},
}

func (s *AICatalogService) ModelProviders() []aiModelProvider {
	out := make([]aiModelProvider, len(adminAIModelProviders))
	copy(out, adminAIModelProviders)
	return out
}

func (s *AICatalogService) ImportProviderModels(ctx context.Context, groupUID uuid.UUID, providerID, modelsURL, envVarName string) (AdminGroupView, int, string, error) {
	group, err := s.q.GetAIGroupByUID(ctx, groupUID)
	if err != nil {
		return AdminGroupView{}, 0, "", mapNoRows(err)
	}
	envName, err := domain.ValidateEnvVarName(envVarName)
	if err != nil || envName == "" {
		return AdminGroupView{}, 0, "", domain.ErrEnvVarInvalid
	}
	apiKey, ok := s.secrets.Resolve(envName)
	if !ok {
		return AdminGroupView{}, 0, "", domain.ErrAPIKeyNotConfigured
	}
	u, err := validateAdminModelsURL(modelsURL)
	if err != nil {
		return AdminGroupView{}, 0, "", err
	}
	prov := resolveAIModelProviderForImport(providerID, u)
	models, err := s.requestProviderAIModels(ctx, prov, u, apiKey)
	if err != nil {
		return AdminGroupView{}, 0, "", err
	}
	imported := normalizeProviderModels(models)
	if len(imported) == 0 {
		return AdminGroupView{}, 0, "", fmt.Errorf("%w", domain.ErrModelsImportEmpty)
	}
	existing, _ := s.q.ListAIVariantsByGroup(ctx, groupUID)
	hasDefault := false
	for _, v := range existing {
		hasDefault = hasDefault || v.IsDefault
	}
	for i, v := range imported {
		def := !hasDefault && i == 0
		if _, err := s.q.UpsertAIVariantImport(ctx, dbgen.UpsertAIVariantImportParams{
			Uid:               domain.NewUID(),
			GroupUid:          groupUID,
			Slug:              v.Slug,
			ProviderModelID:   v.ProviderModelID,
			Label:             v.Label,
			IsDefault:         def,
			Position:          int32(i),
		}); err != nil {
			return AdminGroupView{}, 0, "", err
		}
		if def {
			hasDefault = true
		}
	}
	dg := dbGroupToDomain(group)
	variants, _ := s.q.ListAIVariantsByGroup(ctx, groupUID)
	for _, v := range variants {
		dg.Variants = append(dg.Variants, dbVariantToDomain(v))
	}
	return s.GroupAdminView(dg), len(imported), u, nil
}

type upstreamAIModel struct {
	ID          string
	DisplayName string
}

func adminAIModelProviderByID(id string) aiModelProvider {
	for _, p := range adminAIModelProviders {
		if p.ID == id {
			return p
		}
	}
	return aiModelProvider{ID: strings.TrimSpace(id), Label: "Custom", AuthScheme: aiModelProviderAuthAnthropic}
}

// inferAIModelProviderFromModelsURL picks auth headers from the listing URL host.
// Most providers use Bearer; Anthropic and Google need special headers.
func inferAIModelProviderFromModelsURL(modelsURL string) aiModelProvider {
	u, err := url.Parse(modelsURL)
	if err != nil || u.Hostname() == "" {
		return aiModelProvider{ID: "inferred", Label: "Inferred", ModelsURL: modelsURL, AuthScheme: aiModelProviderAuthBearer}
	}
	host := strings.ToLower(u.Hostname())
	switch {
	case strings.Contains(host, "anthropic.com"):
		return aiModelProvider{ID: "anthropic", Label: "Anthropic Claude", ModelsURL: modelsURL, AuthScheme: aiModelProviderAuthAnthropic}
	case strings.Contains(host, "generativelanguage.googleapis.com"),
		strings.Contains(host, "googleapis.com"):
		return aiModelProvider{ID: "google-gemini", Label: "Google Gemini", ModelsURL: modelsURL, AuthScheme: aiModelProviderAuthGoogle}
	default:
		// OpenAI-compatible listing endpoints (OpenAI, Groq, Mistral, DeepSeek, Together, etc.).
		return aiModelProvider{ID: "inferred", Label: "Inferred", ModelsURL: modelsURL, AuthScheme: aiModelProviderAuthBearer}
	}
}

// resolveAIModelProviderForImport uses explicit provider id when known; otherwise infers from URL.
func resolveAIModelProviderForImport(providerID, modelsURL string) aiModelProvider {
	explicit := strings.TrimSpace(providerID)
	if explicit != "" {
		p := adminAIModelProviderByID(explicit)
		if p.Label != "Custom" {
			return p
		}
	}
	return inferAIModelProviderFromModelsURL(modelsURL)
}

func validateAdminModelsURL(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", fmt.Errorf("modelsUrl required")
	}
	if len(s) > maxAdminModelsURLLen {
		return "", fmt.Errorf("modelsUrl too long")
	}
	u, err := url.ParseRequestURI(s)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("modelsUrl must be a valid URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("modelsUrl must use http or https")
	}
	if u.User != nil {
		return "", fmt.Errorf("modelsUrl must not contain credentials")
	}
	return u.String(), nil
}

func (s *AICatalogService) requestProviderAIModels(ctx context.Context, provider aiModelProvider, modelsURL, apiKey string) ([]upstreamAIModel, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, modelsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: build request", domain.ErrUpstreamModels)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	switch provider.AuthScheme {
	case aiModelProviderAuthGoogle:
		req.Header.Set("x-goog-api-key", apiKey)
	case aiModelProviderAuthAnthropic:
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	default:
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrUpstreamModels, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxAdminModelsResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%w: read body", domain.ErrUpstreamModels)
	}
	if len(body) > maxAdminModelsResponseBytes {
		return nil, fmt.Errorf("%w: response too large", domain.ErrUpstreamModels)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: status %d", domain.ErrUpstreamModels, resp.StatusCode)
	}
	var raw any
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("%w: invalid json", domain.ErrUpstreamModels)
	}
	return extractProviderModels(raw), nil
}

func extractProviderModels(raw any) []upstreamAIModel {
	switch v := raw.(type) {
	case []any:
		return extractProviderModelsFromArray(v)
	case map[string]any:
		for _, key := range []string{"data", "models"} {
			if arr, ok := v[key].([]any); ok {
				return extractProviderModelsFromArray(arr)
			}
		}
	}
	return nil
}

func extractProviderModelsFromArray(items []any) []upstreamAIModel {
	out := make([]upstreamAIModel, 0, len(items))
	for _, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id := firstStringField(m, "id", "name", "model", "slug")
		if id == "" {
			continue
		}
		label := firstStringField(m, "display_name", "displayName", "label", "name")
		out = append(out, upstreamAIModel{ID: id, DisplayName: label})
	}
	return out
}

func firstStringField(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if v, ok := m[key].(string); ok {
			if s := strings.TrimSpace(v); s != "" {
				return s
			}
		}
	}
	return ""
}

func normalizeProviderModels(models []upstreamAIModel) []domain.AIImportedVariant {
	out := make([]domain.AIImportedVariant, 0, len(models))
	seen := make(map[string]struct{}, len(models))
	for _, m := range models {
		slug := normalizeImportedModelSlug(m.ID)
		if slug == "" {
			continue
		}
		if _, ok := seen[slug]; ok {
			continue
		}
		seen[slug] = struct{}{}
		label := strings.TrimSpace(m.DisplayName)
		if label == "" {
			label = strings.TrimSpace(m.ID)
		}
		out = append(out, domain.AIImportedVariant{
			Slug:            slug,
			ProviderModelID: strings.TrimSpace(m.ID),
			Label:           label,
		})
	}
	return out
}

func normalizeImportedModelSlug(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = strings.TrimSuffix(s, "/")
	if i := strings.LastIndexByte(s, '/'); i >= 0 {
		s = s[i+1:]
	}
	var b strings.Builder
	lastDash := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			b.WriteByte(c)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if _, err := domain.ValidateSlug(out); err != nil {
		return ""
	}
	return out
}

func (s *AICatalogService) SeedDefaultIfEmpty(ctx context.Context) error {
	n, err := s.q.CountAIGroups(ctx)
	if err != nil || n > 0 {
		return err
	}
	type g struct {
		slug, label, role, color string
		free                     bool
		pos                      int
	}
	type v struct {
		slug, providerID, label string
		def                     bool
		pos                     int
	}
	groups := []g{
		{"deepseek", "DeepSeek", "Черновик", "#4ade80", true, 0},
		{"claude", "Claude", "Редактура", "#7c6af7", false, 1},
		{"gpt", "GPT", "Идеи", "#f472b6", false, 2},
		{"grok", "Grok", "Идеи", "#f59e0b", false, 3},
		{"gemini", "Gemini", "Идеи", "#60a5fa", false, 4},
	}
	variants := map[string][]v{
		"claude":   {{"claude-opus-4-6", "claude-opus-4-6", "Opus 4.6", true, 0}, {"claude-sonnet-4-6", "claude-sonnet-4-6", "Sonnet 4.6", false, 1}, {"claude-haiku-4-5", "claude-haiku-4-5", "Haiku 4.5", false, 2}},
		"deepseek": {{"deepseek-v3-2", "deepseek-v3-2", "V3.2", true, 0}, {"deepseek-chat", "deepseek-chat", "", false, 1}, {"deepseek-v3-2-exp", "deepseek-v3-2-exp", "V3.2-Exp", false, 2}, {"deepseek-v4", "deepseek-v4", "V4", false, 3}},
		"gpt":      {{"gpt-5-4-thinking", "gpt-5-4-thinking", "GPT-5.4 Thinking", true, 0}, {"gpt-5-4-pro", "gpt-5-4-pro", "GPT-5.4 Pro", false, 1}, {"gpt-5-4-mini", "gpt-5-4-mini", "GPT-5.4 mini", false, 2}},
		"gemini":   {{"gemini-3-flash", "gemini-3-flash", "Gemini-3-Flash", true, 0}, {"gemini-3-pro", "gemini-3-pro", "Gemini-3-Pro", false, 1}, {"gemini-1-5-pro", "gemini-1-5-pro", "Gemini-1.5-Pro", false, 2}},
		"grok":     {{"grok-4-20", "grok-4-20", "Grok 4.20", true, 0}, {"grok-4-1-fast", "grok-4-1-fast", "Grok 4.1 Fast", false, 1}, {"grok-4-1-fast-nr", "grok-4-1-fast-nr", "Grok 4.1 Fast NR", false, 2}},
	}
	for _, gr := range groups {
		pos := gr.pos
		group, err := s.CreateGroup(ctx, CreateGroupInput{
			Slug:     gr.slug,
			Label:    gr.label,
			Role:     gr.role,
			Color:    gr.color,
			Free:     gr.free,
			Position: &pos,
		})
		if err != nil && !isUniqueViolation(err) {
			return err
		}
		for _, vv := range variants[gr.slug] {
			p := vv.pos
			if _, err := s.CreateVariant(ctx, CreateVariantInput{
				GroupUID:        group.UID,
				Slug:            vv.slug,
				ProviderModelID: vv.providerID,
				Label:           vv.label,
				IsDefault:       vv.def,
				Position:        &p,
			}); err != nil && !isUniqueViolation(err) {
				return err
			}
		}
	}
	return nil
}

func normalizeCatalogErr(err error) error {
	if err == nil {
		return nil
	}
	if err == pgx.ErrNoRows {
		return domain.ErrNotFound
	}
	return err
}
