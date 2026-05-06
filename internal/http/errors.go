package http

import (
	"encoding/json"
	"errors"
	stdhttp "net/http"

	"github.com/oldwhale/backend/internal/domain"
	"github.com/oldwhale/backend/internal/service"
)

func ServiceErrToHTTP(err error) (int, string) {
	switch {
	case err == nil:
		return stdhttp.StatusOK, ""
	case errors.Is(err, domain.ErrNotFound):
		return stdhttp.StatusNotFound, "not found"
	case errors.Is(err, domain.ErrConflict):
		return stdhttp.StatusConflict, "conflict"
	case errors.Is(err, domain.ErrUnauthorized):
		return stdhttp.StatusUnauthorized, "unauthorized"
	case errors.Is(err, domain.ErrForbidden):
		return stdhttp.StatusForbidden, "forbidden"
	case errors.Is(err, domain.ErrAPIKeyNotConfigured):
		return stdhttp.StatusBadGateway, "api key not configured"
	case errors.Is(err, domain.ErrSlugInvalid), errors.Is(err, domain.ErrColorInvalid),
		errors.Is(err, domain.ErrEnvVarInvalid), errors.Is(err, domain.ErrLabelRequired),
		errors.Is(err, domain.ErrInvalidInput):
		return stdhttp.StatusBadRequest, err.Error()
	case errors.Is(err, service.ErrPrefsTooLarge):
		return stdhttp.StatusRequestEntityTooLarge, "preferences too large"
	case errors.Is(err, domain.ErrUpstreamModels):
		return stdhttp.StatusBadGateway, "upstream models request failed"
	case errors.Is(err, domain.ErrModelsImportEmpty):
		return stdhttp.StatusBadRequest, "models response contained no importable models"
	default:
		return stdhttp.StatusInternalServerError, "server error"
	}
}

func jsonErr(w stdhttp.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func jsonOK(w stdhttp.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func serviceErr(w stdhttp.ResponseWriter, err error) {
	code, msg := ServiceErrToHTTP(err)
	jsonErr(w, code, msg)
}
