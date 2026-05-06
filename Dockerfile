# syntax=docker/dockerfile:1
# Production-style image: static Go binary, no SQLite, PostgreSQL only at runtime via DATABASE_URL.

FROM golang:1.26-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Generated code under internal/db/generated and internal/http/generated is committed;
# production builds compile it as-is and do not run codegen.
RUN CGO_ENABLED=0 GOOS=linux go build -tags netgo -ldflags '-s -w' -o /out/app ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/app ./app
USER nobody
EXPOSE 8080
ENV PORT=8080
CMD ["./app"]
