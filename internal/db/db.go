package db

import (
	"database/sql"
	"errors"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

// Database wraps a *sql.DB and records whether the driver is PostgreSQL (placeholder syntax differs).
type Database struct {
	sql *sql.DB
	pg  bool
}

// OpenFromEnv opens PostgreSQL when DATABASE_URL is set (e.g. Render), otherwise SQLite using DB_PATH or ./data/oldwhale.db.
func OpenFromEnv() (*Database, error) {
	url := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if url != "" {
		return openPostgres(url)
	}
	return openSQLite(sqlitePath())
}

func sqlitePath() string {
	p := strings.TrimSpace(os.Getenv("DB_PATH"))
	if p == "" {
		return "./data/oldwhale.db"
	}
	return p
}

func openSQLite(path string) (*Database, error) {
	if err := os.MkdirAll("./data", 0o755); err != nil {
		return nil, err
	}
	inner, err := sql.Open("sqlite", path+"?_foreign_keys=on&_journal_mode=WAL")
	if err != nil {
		return nil, err
	}
	d := &Database{sql: inner, pg: false}
	if err := d.migrateSQLite(); err != nil {
		_ = inner.Close()
		return nil, err
	}
	return d, nil
}

func openPostgres(url string) (*Database, error) {
	inner, err := sql.Open("pgx", url)
	if err != nil {
		return nil, err
	}
	inner.SetMaxOpenConns(10)
	d := &Database{sql: inner, pg: true}
	if err := d.migratePostgres(); err != nil {
		_ = inner.Close()
		return nil, err
	}
	return d, nil
}

func (d *Database) migrateSQLite() error {
	_, err := d.sql.Exec(`
CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	login TEXT NOT NULL UNIQUE,
	email TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'user',
	disabled INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);
`)
	return err
}

func (d *Database) migratePostgres() error {
	_, err := d.sql.Exec(`
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
	_, err = d.sql.Exec(`CREATE INDEX IF NOT EXISTS idx_users_login ON users(login)`)
	return err
}

// Ping checks connectivity to the database server.
func (d *Database) Ping() error {
	return d.sql.Ping()
}

// Close closes the database connection pool.
func (d *Database) Close() error {
	return d.sql.Close()
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
	err := d.sql.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func CreateUser(d *Database, login, email, hash, role string) (*User, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	if d.pg {
		var id int64
		err := d.sql.QueryRow(
			`INSERT INTO users(login,email,password_hash,role,disabled,created_at) VALUES ($1,$2,$3,$4,0,$5) RETURNING id`,
			login, email, hash, role, now,
		).Scan(&id)
		if err != nil {
			return nil, err
		}
		return GetUserByID(d, id)
	}
	res, err := d.sql.Exec(
		`INSERT INTO users(login,email,password_hash,role,disabled,created_at) VALUES (?,?,?,?,0,?)`,
		login, email, hash, role, now,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return GetUserByID(d, id)
}

func GetUserByLogin(d *Database, login string) (*User, error) {
	var row *sql.Row
	if d.pg {
		row = d.sql.QueryRow(
			`SELECT id,login,email,password_hash,role,disabled,created_at FROM users WHERE login=$1`,
			login,
		)
	} else {
		row = d.sql.QueryRow(
			`SELECT id,login,email,password_hash,role,disabled,created_at FROM users WHERE login=?`,
			login,
		)
	}
	return scanUser(row)
}

func GetUserByID(d *Database, id int64) (*User, error) {
	var row *sql.Row
	if d.pg {
		row = d.sql.QueryRow(
			`SELECT id,login,email,password_hash,role,disabled,created_at FROM users WHERE id=$1`,
			id,
		)
	} else {
		row = d.sql.QueryRow(
			`SELECT id,login,email,password_hash,role,disabled,created_at FROM users WHERE id=?`,
			id,
		)
	}
	return scanUser(row)
}

func ListUsers(d *Database) ([]User, error) {
	rows, err := d.sql.Query(`SELECT id,login,email,password_hash,role,disabled,created_at FROM users ORDER BY id`)
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
		var e error
		if d.pg {
			_, e = d.sql.Exec(`UPDATE users SET disabled=$1 WHERE id=$2`, dis, id)
		} else {
			_, e = d.sql.Exec(`UPDATE users SET disabled=? WHERE id=?`, dis, id)
		}
		if e != nil {
			return nil, e
		}
	}
	if role != nil && *role != "" {
		var e error
		if d.pg {
			_, e = d.sql.Exec(`UPDATE users SET role=$1 WHERE id=$2`, *role, id)
		} else {
			_, e = d.sql.Exec(`UPDATE users SET role=? WHERE id=?`, *role, id)
		}
		if e != nil {
			return nil, e
		}
	}
	return GetUserByID(d, id)
}

func DeleteUser(d *Database, id int64) error {
	var err error
	if d.pg {
		_, err = d.sql.Exec(`DELETE FROM users WHERE id=$1`, id)
	} else {
		_, err = d.sql.Exec(`DELETE FROM users WHERE id=?`, id)
	}
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
