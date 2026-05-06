package domain

import "time"

type AIModelGroup struct {
	Meta
	Slug         string
	Label        string
	Role         string
	Color        string
	Free         bool
	Position     int
	APIKeyEnvVar string
	DeletedAt    *time.Time
	Variants     []AIModelVariant
}

type AIModelVariant struct {
	Meta
	GroupUID          UID
	Slug              string
	ProviderModelID   string
	Label             string
	IsDefault         bool
	Position          int
	DeletedAt         *time.Time
}

type AIImportedVariant struct {
	Slug            string
	ProviderModelID string
	Label           string
}
