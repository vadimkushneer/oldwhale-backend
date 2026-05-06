package http

import (
	"testing"
	"time"

	"github.com/oldwhale/backend/internal/domain"
	"github.com/oldwhale/backend/internal/service"
)

func TestDomainToAPIPublicCatalogFiltersPaidForGuests(t *testing.T) {
	now := time.Now()
	groups := []domain.AIModelGroup{
		{Meta: domain.Meta{UID: domain.NewUID(), CreatedAt: now, UpdatedAt: now}, Slug: "free", Label: "Free", Free: true},
		{Meta: domain.Meta{UID: domain.NewUID(), CreatedAt: now, UpdatedAt: now}, Slug: "paid", Label: "Paid", Free: false},
	}
	got := DomainToAPIPublicCatalog(groups, false)
	if len(got.Groups) != 1 || got.Groups[0].Slug != "free" {
		t.Fatalf("unexpected catalog: %#v", got.Groups)
	}
}

func TestDomainToAPIPublicCatalogIncludesPaidForAuthenticatedUsers(t *testing.T) {
	now := time.Now()
	groups := []domain.AIModelGroup{
		{Meta: domain.Meta{UID: domain.NewUID(), CreatedAt: now, UpdatedAt: now}, Slug: "free", Label: "Free", Free: true},
		{Meta: domain.Meta{UID: domain.NewUID(), CreatedAt: now, UpdatedAt: now}, Slug: "paid", Label: "Paid", Free: false},
	}
	got := DomainToAPIPublicCatalog(groups, true)
	if len(got.Groups) != 2 {
		t.Fatalf("expected all groups, got %#v", got.Groups)
	}
}

func TestDomainToAPIGroupAdminSetsAPIKeyPresent(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY_TEST", "secret")
	now := time.Now()
	group := domain.AIModelGroup{
		Meta:         domain.Meta{UID: domain.NewUID(), CreatedAt: now, UpdatedAt: now},
		Slug:         "claude",
		Label:        "Claude",
		APIKeyEnvVar: "ANTHROPIC_API_KEY_TEST",
	}
	secrets := service.NewSecretsService()
	api := DomainToAPIGroupAdmin(service.AdminGroupView{Group: group, APIKeyPresent: secrets.IsResolvable(group.APIKeyEnvVar)})
	if !api.ApiKeyPresent || api.ApiKeyEnvVar != "ANTHROPIC_API_KEY_TEST" {
		t.Fatalf("unexpected admin group: %#v", api)
	}
}
