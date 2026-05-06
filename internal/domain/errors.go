package domain

import "errors"

var (
	ErrNotFound                = errors.New("not found")
	ErrConflict                = errors.New("conflict")
	ErrUnauthorized            = errors.New("unauthorized")
	ErrForbidden               = errors.New("forbidden")
	ErrSlugInvalid             = errors.New("invalid slug")
	ErrColorInvalid            = errors.New("invalid color")
	ErrEnvVarInvalid           = errors.New("invalid environment variable name")
	ErrLabelRequired           = errors.New("label required")
	ErrAPIKeyNotConfigured     = errors.New("api key not configured")
	ErrAdminCredentialsMissing = errors.New("admin credentials missing")
	ErrInvalidInput            = errors.New("invalid input")
	ErrUpstreamModels          = errors.New("upstream models request failed")
	ErrModelsImportEmpty       = errors.New("models response contained no importable models")
)
