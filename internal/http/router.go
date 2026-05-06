package http

import (
	_ "embed"
	stdhttp "net/http"

	"github.com/go-chi/chi/v5"

	apigen "github.com/oldwhale/backend/internal/http/generated"
)

//go:embed openapi.yaml
var openapiYAML []byte

const swaggerUIPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Old Whale API - Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" crossorigin="anonymous" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin="anonymous"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "/openapi.yaml",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
      });
    };
  </script>
</body>
</html>`

func NewRouter(h *Handlers, secret []byte, corsOrigin string) stdhttp.Handler {
	r := chi.NewRouter()
	r.Use(Recover, SlogLogger, CORS(corsOrigin))
	r.Get("/openapi.yaml", func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
		_, _ = w.Write(openapiYAML)
	})
	r.Get("/swagger", func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(swaggerUIPage))
	})
	r.Group(func(r chi.Router) {
		r.Use(BearerUser(secret))
		apigen.HandlerFromMux(h, r)
	})
	return r
}
