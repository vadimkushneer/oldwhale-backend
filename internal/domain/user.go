package domain

import "time"

type User struct {
	Meta
	Username     string
	Email        string
	PasswordHash string
	Role         UserRole
	Disabled     bool
	LastLoginAt  *time.Time
}
