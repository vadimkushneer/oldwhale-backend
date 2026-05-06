package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/oldwhale/backend/internal/config"
	dbgen "github.com/oldwhale/backend/internal/db/generated"
	"github.com/oldwhale/backend/internal/schema"
)

type Querier = dbgen.Querier

func OpenPool(ctx context.Context, cfg config.Config) (*pgxpool.Pool, error) {
	pcfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	pcfg.MaxConns = 25
	pcfg.MinConns = 2
	pcfg.MaxConnLifetime = 30 * time.Minute
	pcfg.MaxConnIdleTime = 10 * time.Minute
	pcfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "SET statement_timeout = '30s'")
		return err
	}
	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func ApplySchema(ctx context.Context, pool *pgxpool.Pool, reset bool) error {
	if reset {
		if _, err := pool.Exec(ctx, `
DROP TABLE IF EXISTS ai_chat_logs, ai_model_variants, ai_model_groups, user_ui_preferences, users CASCADE;
DROP FUNCTION IF EXISTS set_updated_at CASCADE;
`); err != nil {
			return fmt.Errorf("reset schema: %w", err)
		}
	}
	if _, err := pool.Exec(ctx, schema.SQL); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	return nil
}
