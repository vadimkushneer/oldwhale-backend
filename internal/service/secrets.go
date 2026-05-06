package service

import (
	"os"
	"strings"

	"github.com/oldwhale/backend/internal/domain"
)

type SecretsService struct{}

func NewSecretsService() *SecretsService {
	return &SecretsService{}
}

func (s *SecretsService) Resolve(envVar string) (string, bool) {
	name, err := domain.ValidateEnvVarName(envVar)
	if err != nil || name == "" {
		return "", false
	}
	value, ok := os.LookupEnv(name)
	value = strings.TrimSpace(value)
	return value, ok && value != ""
}

func (s *SecretsService) IsResolvable(envVar string) bool {
	_, ok := s.Resolve(envVar)
	return ok
}

func (s *SecretsService) CheckByName(name string) (string, bool, error) {
	normalized, err := domain.ValidateEnvVarName(name)
	if err != nil || normalized == "" {
		return "", false, err
	}
	_, present := s.Resolve(normalized)
	return normalized, present, nil
}
