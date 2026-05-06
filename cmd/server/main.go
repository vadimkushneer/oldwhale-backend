package main

import (
	"context"
	"errors"
	"log/slog"
	stdhttp "net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/oldwhale/backend/internal/config"
	"github.com/oldwhale/backend/internal/db"
	dbgen "github.com/oldwhale/backend/internal/db/generated"
	"github.com/oldwhale/backend/internal/domain"
	httpapi "github.com/oldwhale/backend/internal/http"
	"github.com/oldwhale/backend/internal/jobs"
	"github.com/oldwhale/backend/internal/llm"
	"github.com/oldwhale/backend/internal/service"
)

func main() {
	_ = godotenv.Load()
	cfg := config.MustLoad()
	ctx := context.Background()

	pool, err := db.OpenPool(ctx, cfg)
	if err != nil {
		slog.Error("open database", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := db.ApplySchema(ctx, pool, cfg.ResetSchemaOnStart); err != nil {
		slog.Error("apply schema", "err", err)
		os.Exit(1)
	}

	q := dbgen.New(pool)
	secrets := service.NewSecretsService()
	users := service.NewUserService(q)
	catalog := service.NewAICatalogService(q, secrets)
	chatLog := service.NewAIChatLogService(q, pool)
	ui := service.NewAdminUIService(q)
	jobStore := jobs.NewAIChatJobStore()
	llmClient := llm.NewProviderClient(cfg.AnthropicBaseURL, cfg.OllamaBaseURL)
	chat := service.NewAIChatService(q, secrets, jobStore, llmClient, chatLog)

	if err := users.SeedAdmin(ctx, service.AdminSeed{
		Username:     cfg.AdminUsername,
		Password:     cfg.AdminPassword,
		Email:        cfg.AdminEmail,
		SyncPassword: cfg.AdminPasswordSync,
	}); err != nil {
		if errors.Is(err, domain.ErrAdminCredentialsMissing) {
			slog.Error("admin seed credentials missing", "err", err)
			os.Exit(1)
		}
		slog.Error("seed admin", "err", err)
		os.Exit(1)
	}
	if err := catalog.SeedDefaultIfEmpty(ctx); err != nil {
		slog.Error("seed ai catalog", "err", err)
		os.Exit(1)
	}

	handlers := httpapi.NewHandlers(pool, users, catalog, chat, chatLog, ui, secrets, cfg.JWTSecret, cfg.JWTTTL)
	router := httpapi.NewRouter(handlers, cfg.JWTSecret, cfg.CORSOrigin)
	server := &stdhttp.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("Old Whale API listening", "addr", cfg.HTTPAddr)
		errCh <- server.ListenAndServe()
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	select {
	case sig := <-stop:
		slog.Info("shutdown requested", "signal", sig.String())
	case err := <-errCh:
		if err != nil && !errors.Is(err, stdhttp.ErrServerClosed) {
			slog.Error("server stopped", "err", err)
			os.Exit(1)
		}
		return
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown", "err", err)
		os.Exit(1)
	}
}
