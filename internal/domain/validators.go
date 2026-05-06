package domain

import (
	"regexp"
	"strings"
)

var (
	slugRe      = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)
	envVarRe    = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	hexColorLen = map[int]bool{4: true, 5: true, 7: true, 9: true}
)

func ValidateSlug(s string) (string, error) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" || !slugRe.MatchString(s) {
		return "", ErrSlugInvalid
	}
	return s, nil
}

func ValidateColor(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", nil
	}
	if !hexColorLen[len(s)] || s[0] != '#' {
		return "", ErrColorInvalid
	}
	for i := 1; i < len(s); i++ {
		c := s[i]
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F') {
			continue
		}
		return "", ErrColorInvalid
	}
	return s, nil
}

func ValidateEnvVarName(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", nil
	}
	if len(s) > 256 || !envVarRe.MatchString(s) {
		return "", ErrEnvVarInvalid
	}
	return s, nil
}

func ValidateUsername(s string) (string, error) {
	s = strings.TrimSpace(s)
	if len(s) < 2 {
		return "", ErrInvalidInput
	}
	return s, nil
}

func ValidatePassword(s string, minLen int) error {
	if len(s) < minLen {
		return ErrInvalidInput
	}
	return nil
}

func ValidateEmail(s string) (string, error) {
	s = strings.TrimSpace(strings.ToLower(s))
	if !strings.Contains(s, "@") {
		return "", ErrInvalidInput
	}
	return s, nil
}
