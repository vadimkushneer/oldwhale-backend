.PHONY: generate verify-generated build test test-integration run

generate:
	go generate ./...

verify-generated: generate
	@git diff --exit-code -- internal/db/generated internal/http/generated || \
	  (echo "generated code is out of date; run 'make generate'" && exit 1)

build:
	go build -o bin/server ./cmd/server

test:
	go test ./...

test-integration:
	go test -tags=integration ./...

run:
	go run ./cmd/server
