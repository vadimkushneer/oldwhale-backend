package domain

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

type UID = uuid.UUID

func NewUID() UID {
	u, err := uuid.NewV7()
	if err != nil {
		panic(fmt.Errorf("uuid v7: %w", err))
	}
	return u
}

type Meta struct {
	UID       UID
	CreatedAt time.Time
	UpdatedAt time.Time
}
