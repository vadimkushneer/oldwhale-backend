package db

import (
	"database/sql"
	"errors"
	"time"

	_ "modernc.org/sqlite"
)

type User struct {
	ID           int64     `json:"id"`
	Login        string    `json:"login"`
	Email        string    `json:"email"`
	Role         string    `json:"role"`
	Disabled     bool      `json:"disabled"`
	CreatedAt    time.Time `json:"created_at"`
	PasswordHash string    `json:"-"`
}

func Open(path string) (*sql.DB, error) {
	d, err := sql.Open("sqlite", path+"?_foreign_keys=on&_journal_mode=WAL")
	if err != nil {
		return nil, err
	}
	if err := migrate(d); err != nil {
		_ = d.Close()
		return nil, err
	}
	return d, nil
}

func migrate(d *sql.DB) error {
	_, err := d.Exec(`
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

func CountUsers(d *sql.DB) (int, error) {
	var n int
	err := d.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func CreateUser(d *sql.DB, login, email, hash, role string) (*User, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := d.Exec(
		`INSERT INTO users(login,email,password_hash,role,disabled,created_at) VALUES(?,?,?,?,0,?)`,
		login, email, hash, role, now,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return GetUserByID(d, id)
}

func GetUserByLogin(d *sql.DB, login string) (*User, error) {
	row := d.QueryRow(
		`SELECT id,login,email,password_hash,role,disabled,created_at FROM users WHERE login=?`,
		login,
	)
	return scanUser(row)
}

func GetUserByID(d *sql.DB, id int64) (*User, error) {
	row := d.QueryRow(
		`SELECT id,login,email,password_hash,role,disabled,created_at FROM users WHERE id=?`,
		id,
	)
	return scanUser(row)
}

func ListUsers(d *sql.DB) ([]User, error) {
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

func UpdateUser(d *sql.DB, id int64, disabled *bool, role *string) (*User, error) {
	if _, err := GetUserByID(d, id); err != nil {
		return nil, err
	}
	if disabled != nil {
		dis := 0
		if *disabled {
			dis = 1
		}
		if _, e := d.Exec(`UPDATE users SET disabled=? WHERE id=?`, dis, id); e != nil {
			return nil, e
		}
	}
	if role != nil && *role != "" {
		if _, e := d.Exec(`UPDATE users SET role=? WHERE id=?`, *role, id); e != nil {
			return nil, e
		}
	}
	return GetUserByID(d, id)
}

func DeleteUser(d *sql.DB, id int64) error {
	_, err := d.Exec(`DELETE FROM users WHERE id=?`, id)
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
