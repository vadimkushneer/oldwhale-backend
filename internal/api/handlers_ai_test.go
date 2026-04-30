package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/oldwhale/backend/internal/db"
)

func TestPublicAIModelCatalogFiltersPaidForGuests(t *testing.T) {
	groups := []db.AIModelGroup{
		{ID: 1, Slug: "free", Label: "Free", Free: true},
		{ID: 2, Slug: "paid", Label: "Paid", Free: false},
	}
	variants := [][]db.AIModelVariant{
		{{ID: 10, GUID: "11111111-1111-4111-8111-111111111111", GroupID: 1, Slug: "free-model", Label: "Free Model", IsDefault: true}},
		{{ID: 20, GUID: "22222222-2222-4222-8222-222222222222", GroupID: 2, Slug: "paid-model", Label: "Paid Model", IsDefault: true}},
	}

	got := publicAIModelCatalog(groups, variants, false)
	if len(got) != 1 {
		t.Fatalf("expected 1 free group, got %d: %#v", len(got), got)
	}
	if got[0]["slug"] != "free" {
		t.Fatalf("expected free group, got %#v", got[0])
	}
}

func TestPublicAIModelCatalogIncludesPaidForAuthenticatedUsers(t *testing.T) {
	groups := []db.AIModelGroup{
		{ID: 1, Slug: "free", Label: "Free", Free: true},
		{ID: 2, Slug: "paid", Label: "Paid", Free: false},
	}
	variants := [][]db.AIModelVariant{
		{{ID: 10, GUID: "11111111-1111-4111-8111-111111111111", GroupID: 1, Slug: "free-model", Label: "Free Model", IsDefault: true}},
		{{ID: 20, GUID: "22222222-2222-4222-8222-222222222222", GroupID: 2, Slug: "paid-model", Label: "Paid Model", IsDefault: true}},
	}

	got := publicAIModelCatalog(groups, variants, true)
	if len(got) != 2 {
		t.Fatalf("expected all groups, got %d: %#v", len(got), got)
	}
	if got[0]["slug"] != "free" || got[1]["slug"] != "paid" {
		t.Fatalf("unexpected groups: %#v", got)
	}
}

func TestPublicAIModelCatalogIncludesVariantGUID(t *testing.T) {
	groups := []db.AIModelGroup{
		{ID: 1, Slug: "free", Label: "Free", Free: true},
	}
	variants := [][]db.AIModelVariant{
		{{ID: 10, GUID: "11111111-1111-4111-8111-111111111111", GroupID: 1, Slug: "free-model", Label: "Free Model", IsDefault: true}},
	}

	got := publicAIModelCatalog(groups, variants, true)
	gotVariants, ok := got[0]["variants"].([]map[string]any)
	if !ok || len(gotVariants) != 1 {
		t.Fatalf("unexpected variants: %#v", got[0]["variants"])
	}
	if gotVariants[0]["guid"] != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("expected variant guid, got %#v", gotVariants[0])
	}
}

func TestNormalizeProviderModels(t *testing.T) {
	models := []upstreamAIModel{
		{ID: "models/gemini-1.5-pro", DisplayName: "Gemini 1.5 Pro"},
		{ID: "claude-opus-4-7", DisplayName: "Claude Opus 4.7"},
		{ID: "claude-opus-4-7", DisplayName: "duplicate"},
		{ID: "   ", DisplayName: "blank"},
	}

	got := normalizeProviderModels(models)
	if len(got) != 2 {
		t.Fatalf("expected 2 normalized models, got %d: %#v", len(got), got)
	}
	if got[0].Slug != "gemini-1-5-pro" || got[0].Label != "Gemini 1.5 Pro" {
		t.Fatalf("unexpected first model: %#v", got[0])
	}
	if got[1].Slug != "claude-opus-4-7" || got[1].Label != "Claude Opus 4.7" {
		t.Fatalf("unexpected second model: %#v", got[1])
	}
}

func TestExtractProviderModelsFromDataArray(t *testing.T) {
	raw := map[string]any{
		"data": []any{
			map[string]any{"id": "claude-sonnet-4-6", "display_name": "Claude Sonnet 4.6"},
			map[string]any{"id": "claude-haiku-4-5"},
			map[string]any{"type": "not-a-model"},
		},
	}

	got := extractProviderModels(raw)
	if len(got) != 2 {
		t.Fatalf("expected 2 models, got %d: %#v", len(got), got)
	}
	if got[0].ID != "claude-sonnet-4-6" || got[0].DisplayName != "Claude Sonnet 4.6" {
		t.Fatalf("unexpected first model: %#v", got[0])
	}
	if got[1].ID != "claude-haiku-4-5" || got[1].DisplayName != "" {
		t.Fatalf("unexpected second model: %#v", got[1])
	}
}

func TestRequestProviderAIModelsUsesAnthropicHeaders(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("x-api-key"); got != "secret-key" {
			t.Errorf("x-api-key = %q", got)
		}
		if got := r.Header.Get("anthropic-version"); got != "2023-06-01" {
			t.Errorf("anthropic-version = %q", got)
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"claude-sonnet-4-6"}]}`))
	}))
	defer ts.Close()

	models, err := requestProviderAIModels(
		httptest.NewRequest(http.MethodPost, "/api/admin/ai/groups/1/models/import", nil),
		adminAIModelProviderByID("anthropic"),
		ts.URL,
		"secret-key",
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].ID != "claude-sonnet-4-6" {
		t.Fatalf("unexpected models: %#v", models)
	}
}

func TestRequestProviderAIModelsUsesBearerHeaders(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer secret-key" {
			t.Errorf("Authorization = %q", got)
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-5"}]}`))
	}))
	defer ts.Close()

	models, err := requestProviderAIModels(
		httptest.NewRequest(http.MethodPost, "/api/admin/ai/groups/1/models/import", nil),
		adminAIModelProviderByID("openai"),
		ts.URL,
		"secret-key",
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].ID != "gpt-5" {
		t.Fatalf("unexpected models: %#v", models)
	}
}
