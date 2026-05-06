//go:build integration

package db_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/oldwhale/backend/internal/db"
	dbgen "github.com/oldwhale/backend/internal/db/generated"
	"github.com/oldwhale/backend/internal/domain"
	"github.com/oldwhale/backend/internal/service"
)

func integrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := db.ApplySchema(ctx, pool, true); err != nil {
		t.Fatal(err)
	}
	return pool
}

func TestIntegrationUsersCRUD(t *testing.T) {
	pool := integrationPool(t)
	users := service.NewUserService(dbgen.New(pool))
	ctx := context.Background()
	u, err := users.Create(ctx, service.CreateUserInput{Username: "tester", Email: "tester@example.com", Password: "secret123", Role: domain.RoleUser})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := users.GetByUID(ctx, u.UID); err != nil {
		t.Fatal(err)
	}
	if err := users.Delete(ctx, u.UID); err != nil {
		t.Fatal(err)
	}
}

func TestIntegrationAICatalogSoftDeleteRecreateSlug(t *testing.T) {
	pool := integrationPool(t)
	catalog := service.NewAICatalogService(dbgen.New(pool), service.NewSecretsService())
	ctx := context.Background()
	g, err := catalog.CreateGroup(ctx, service.CreateGroupInput{Slug: "test", Label: "Test"})
	if err != nil {
		t.Fatal(err)
	}
	if err := catalog.SoftDeleteGroup(ctx, g.UID); err != nil {
		t.Fatal(err)
	}
	if _, err := catalog.CreateGroup(ctx, service.CreateGroupInput{Slug: "test", Label: "Test Again"}); err != nil {
		t.Fatal(err)
	}
}

func TestIntegrationChatLogInsertAndFilteredList(t *testing.T) {
	pool := integrationPool(t)
	q := dbgen.New(pool)
	logs := service.NewAIChatLogService(q, pool)
	ctx := context.Background()
	entry := domain.AIChatLog{
		UID:                 domain.NewUID(),
		Message:             "hello whale",
		Reply:               "reply whale",
		UserMessageUID:      domain.NewUID(),
		AssistantMessageUID: domain.NewUID(),
		EditorMode:          domain.EditorModeFilm,
	}
	if _, err := logs.Insert(ctx, entry); err != nil {
		t.Fatal(err)
	}
	needle := "whale"
	items, total, err := logs.ListAdmin(ctx, service.AIChatLogFilters{MessageContains: &needle}, service.Page{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(items) != 1 {
		t.Fatalf("expected one log, total=%d len=%d", total, len(items))
	}
}
