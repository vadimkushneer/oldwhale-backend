package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"

	dbgen "github.com/oldwhale/backend/internal/db/generated"
	"github.com/oldwhale/backend/internal/domain"
)

type UserService struct {
	q dbgen.Querier
}

func NewUserService(q dbgen.Querier) *UserService {
	return &UserService{q: q}
}

type CreateUserInput struct {
	Username string
	Email    string
	Password string
	Role     domain.UserRole
	Disabled bool
	MinPass  int
}

type AdminSeed struct {
	Username       string
	Password       string
	Email          string
	SyncPassword   bool
}

type Page struct {
	Limit  int
	Offset int
}

func (s *UserService) Create(ctx context.Context, in CreateUserInput) (domain.User, error) {
	minPass := in.MinPass
	if minPass == 0 {
		minPass = 6
	}
	username, err := domain.ValidateUsername(in.Username)
	if err != nil {
		return domain.User{}, err
	}
	email, err := domain.ValidateEmail(in.Email)
	if err != nil {
		return domain.User{}, err
	}
	if err := domain.ValidatePassword(in.Password, minPass); err != nil {
		return domain.User{}, err
	}
	role := in.Role
	if !role.IsValid() {
		role = domain.RoleUser
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return domain.User{}, err
	}
	u, err := s.q.CreateUser(ctx, dbgen.CreateUserParams{
		Uid:          domain.NewUID(),
		Username:     username,
		Email:        email,
		PasswordHash: string(hash),
		Role:         string(role),
		Disabled:     in.Disabled,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return domain.User{}, domain.ErrConflict
		}
		return domain.User{}, err
	}
	return dbUserToDomain(u), nil
}

func (s *UserService) Register(ctx context.Context, username, email, password string) (domain.User, error) {
	return s.Create(ctx, CreateUserInput{
		Username: username,
		Email:    email,
		Password: password,
		Role:     domain.RoleUser,
		MinPass:  6,
	})
}

func (s *UserService) AdminCreate(ctx context.Context, in CreateUserInput) (domain.User, error) {
	in.MinPass = 4
	if !in.Role.IsValid() {
		in.Role = domain.RoleUser
	}
	return s.Create(ctx, in)
}

func (s *UserService) Login(ctx context.Context, username, password string) (domain.User, error) {
	username, err := domain.ValidateUsername(username)
	if err != nil {
		return domain.User{}, domain.ErrUnauthorized
	}
	u, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.User{}, domain.ErrUnauthorized
		}
		return domain.User{}, err
	}
	if u.Disabled {
		return domain.User{}, domain.ErrForbidden
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return domain.User{}, domain.ErrUnauthorized
	}
	updated, err := s.q.RecordUserLogin(ctx, u.Uid)
	if err != nil {
		return dbUserToDomain(u), nil
	}
	return dbUserToDomain(updated), nil
}

func (s *UserService) GetByUID(ctx context.Context, uid uuid.UUID) (domain.User, error) {
	u, err := s.q.GetUserByUID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.User{}, domain.ErrNotFound
		}
		return domain.User{}, err
	}
	return dbUserToDomain(u), nil
}

func (s *UserService) GetByUsername(ctx context.Context, username string) (domain.User, error) {
	u, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.User{}, domain.ErrNotFound
		}
		return domain.User{}, err
	}
	return dbUserToDomain(u), nil
}

func (s *UserService) List(ctx context.Context, page Page) ([]domain.User, error) {
	if page.Limit <= 0 {
		page.Limit = 100
	}
	if page.Offset < 0 {
		page.Offset = 0
	}
	rows, err := s.q.ListUsersPaged(ctx, dbgen.ListUsersPagedParams{Limit: int32(page.Limit), Offset: int32(page.Offset)})
	if err != nil {
		return nil, err
	}
	out := make([]domain.User, 0, len(rows))
	for _, row := range rows {
		out = append(out, dbUserToDomain(row))
	}
	return out, nil
}

func (s *UserService) Patch(ctx context.Context, uid uuid.UUID, disabled *bool, role *domain.UserRole) (domain.User, error) {
	var current domain.User
	var err error
	if disabled != nil {
		row, e := s.q.UpdateUserDisabled(ctx, dbgen.UpdateUserDisabledParams{Uid: uid, Disabled: *disabled})
		if e != nil {
			return domain.User{}, mapNoRows(e)
		}
		current = dbUserToDomain(row)
	}
	if role != nil {
		if !role.IsValid() {
			return domain.User{}, domain.ErrInvalidInput
		}
		row, e := s.q.UpdateUserRole(ctx, dbgen.UpdateUserRoleParams{Uid: uid, Role: string(*role)})
		if e != nil {
			return domain.User{}, mapNoRows(e)
		}
		current = dbUserToDomain(row)
	}
	if disabled == nil && role == nil {
		current, err = s.GetByUID(ctx, uid)
	}
	return current, err
}

func (s *UserService) Delete(ctx context.Context, uid uuid.UUID) error {
	n, err := s.q.DeleteUser(ctx, uid)
	if err != nil {
		return err
	}
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *UserService) RecordLogin(ctx context.Context, uid uuid.UUID) error {
	_, err := s.q.RecordUserLogin(ctx, uid)
	return mapNoRows(err)
}

func (s *UserService) SeedAdmin(ctx context.Context, seed AdminSeed) error {
	if seed.Username == "" || seed.Password == "" {
		return domain.ErrAdminCredentialsMissing
	}
	row, err := s.q.GetUserByUsername(ctx, seed.Username)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = s.Create(ctx, CreateUserInput{
			Username: seed.Username,
			Email:    seed.Email,
			Password: seed.Password,
			Role:     domain.RoleAdmin,
			MinPass:  4,
		})
		return err
	}
	if err != nil {
		return err
	}

	u := dbUserToDomain(row)
	passOK := bcrypt.CompareHashAndPassword([]byte(row.PasswordHash), []byte(seed.Password)) == nil

	if !seed.SyncPassword {
		return nil
	}

	if u.Role != domain.RoleAdmin {
		if _, err := s.q.UpdateUserRole(ctx, dbgen.UpdateUserRoleParams{
			Uid:  row.Uid,
			Role: string(domain.RoleAdmin),
		}); err != nil {
			return err
		}
	}

	if passOK {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(seed.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.q.UpdateUserPasswordHash(ctx, dbgen.UpdateUserPasswordHashParams{
		Uid:          row.Uid,
		PasswordHash: string(hash),
	})
	return err
}

func isUniqueViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

func mapNoRows(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ErrNotFound
	}
	return err
}
