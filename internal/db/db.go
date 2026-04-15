package db

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// Database is a PostgreSQL connection pool (via pgx stdlib driver).
type Database struct {
	*sql.DB
}

// OpenFromEnv opens PostgreSQL using DATABASE_URL (required).
func OpenFromEnv() (*Database, error) {
	url := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if url == "" {
		return nil, fmt.Errorf("DATABASE_URL is required: set it to a PostgreSQL connection URI (see README_DOCKER.md and README_DATABASE.md)")
	}
	// Strip a single pair of surrounding quotes (some dashboards store values that way).
	if len(url) >= 2 {
		if url[0] == '"' && url[len(url)-1] == '"' {
			url = url[1 : len(url)-1]
		} else if url[0] == '\'' && url[len(url)-1] == '\'' {
			url = url[1 : len(url)-1]
		}
	}
	url = strings.TrimSpace(url)
	if strings.Contains(url, "${") {
		return nil, fmt.Errorf("DATABASE_URL still contains ${...} (got %q): this is an App Platform bindable that was not resolved to a postgres URI. Put DATABASE_URL on the web component at runtime (not only build time), use insert reference so the name matches your database component, or paste a full postgres://… string from the database connection UI — see README_DATABASE.md § DigitalOcean App Platform", url)
	}
	inner, err := sql.Open("pgx", url)
	if err != nil {
		return nil, err
	}
	inner.SetMaxOpenConns(10)
	d := &Database{inner}
	if err := d.migrate(); err != nil {
		_ = inner.Close()
		return nil, err
	}
	return d, nil
}

func (d *Database) migrate() error {
	_, err := d.Exec(`
CREATE TABLE IF NOT EXISTS users (
	id BIGSERIAL PRIMARY KEY,
	login TEXT NOT NULL UNIQUE,
	email TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'user',
	disabled INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
)`)
	if err != nil {
		return err
	}
	_, err = d.Exec(`CREATE INDEX IF NOT EXISTS idx_users_login ON users(login)`)
	return err
}

type User struct {
	ID           int64     `json:"id"`
	Login        string    `json:"login"`
	Email        string    `json:"email"`
	Role         string    `json:"role"`
	Disabled     bool      `json:"disabled"`
	CreatedAt    time.Time `json:"created_at"`
	PasswordHash string    `json:"-"`
}

func CountUsers(d *Database) (int, error) {
	var n int
	err := d.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func CreateUser(d *Database, login, email, hash, role string) (*User, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	var id int64
	err := d.QueryRow(
		`INSERT INTO users(login,email,password_hash,role,disabled,created_at) VALUES ($1,$2,$3,$4,0,$5) RETURNING id`,
		login, email, hash, role, now,
	).Scan(&id)
	if err != nil {
		return nil, err
	}
	return GetUserByID(d, id)
}

func GetUserByLogin(d *Database, login string) (*User, error) {
	row := d.QueryRow(
		`SELECT id,login,email,password_hash,role,disabled,created_at FROM users WHERE login=$1`,
		login,
	)
	return scanUser(row)
}

func GetUserByID(d *Database, id int64) (*User, error) {
	row := d.QueryRow(
		`SELECT id,login,email,password_hash,role,disabled,created_at FROM users WHERE id=$1`,
		id,
	)
	return scanUser(row)
}

func ListUsers(d *Database) ([]User, error) {
	rows, err := d.Query(`SELECT id,login,email,password_hash,role,disabled,created_at FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		u, err := scanUserRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

func UpdateUser(d *Database, id int64, disabled *bool, role *string) (*User, error) {
	if _, err := GetUserByID(d, id); err != nil {
		return nil, err
	}
	if disabled != nil {
		dis := 0
		if *disabled {
			dis = 1
		}
		if _, e := d.Exec(`UPDATE users SET disabled=$1 WHERE id=$2`, dis, id); e != nil {
			return nil, e
		}
	}
	if role != nil && *role != "" {
		if _, e := d.Exec(`UPDATE users SET role=$1 WHERE id=$2`, *role, id); e != nil {
			return nil, e
		}
	}
	return GetUserByID(d, id)
}

func DeleteUser(d *Database, id int64) error {
	_, err := d.Exec(`DELETE FROM users WHERE id=$1`, id)
	return err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanUser(row scanner) (*User, error) {
	var u User
	var created string
	var dis int
	err := row.Scan(&u.ID, &u.Login, &u.Email, &u.PasswordHash, &u.Role, &dis, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	u.Disabled = dis != 0
	u.CreatedAt, _ = time.Parse(time.RFC3339, created)
	return &u, nil
}

func scanUserRows(rows *sql.Rows) (*User, error) {
	var u User
	var created string
	var dis int
	err := rows.Scan(&u.ID, &u.Login, &u.Email, &u.PasswordHash, &u.Role, &dis, &created)
	if err != nil {
		return nil, err
	}
	u.Disabled = dis != 0
	u.CreatedAt, _ = time.Parse(time.RFC3339, created)
	return &u, nil
}
