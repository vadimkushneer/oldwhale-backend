package http

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestParseCORSAllowlistEmpty(t *testing.T) {
	if got := parseCORSAllowlist(""); got != nil {
		t.Fatalf("expected nil for empty input, got %#v", got)
	}
	if got := parseCORSAllowlist("   "); got != nil {
		t.Fatalf("expected nil for whitespace input, got %#v", got)
	}
}

func TestParseCORSAllowlistWildcard(t *testing.T) {
	got := parseCORSAllowlist(`"*"`)
	want := []string{"*"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected %#v, got %#v", want, got)
	}
}

func TestParseCORSAllowlistMultiple(t *testing.T) {
	got := parseCORSAllowlist(" http://localhost:5173 , https://localhost ,capacitor://localhost ,, garbage")
	want := []string{
		"http://localhost:5173",
		"https://localhost",
		"capacitor://localhost",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected %#v, got %#v", want, got)
	}
}

func TestParseCORSAllowlistDeduplicates(t *testing.T) {
	got := parseCORSAllowlist("https://a.example, https://a.example/, https://a.example")
	want := []string{"https://a.example"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected %#v, got %#v", want, got)
	}
}

func TestCORSWildcardWhenUnset(t *testing.T) {
	h := CORS("")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://anything.example")
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected wildcard, got %q", got)
	}
}

func TestCORSEchoesAllowedOrigin(t *testing.T) {
	h := CORS("http://localhost:5173, https://localhost")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://localhost")
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://localhost" {
		t.Fatalf("expected echo of allowed origin, got %q", got)
	}
	if got := rec.Header().Get("Vary"); got != "Origin" {
		t.Fatalf("expected Vary: Origin, got %q", got)
	}
}

func TestCORSDisallowedOriginFallsBackToFirst(t *testing.T) {
	h := CORS("http://localhost:5173, https://localhost")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://attacker.example")
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("expected fallback to first allowed origin, got %q", got)
	}
}

func TestCORSPreflightOptionsReturns204(t *testing.T) {
	h := CORS("http://localhost:5173")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatalf("OPTIONS preflight should not reach next handler")
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
}
