export type UserRole = 'user' | 'admin';

export interface UserRow {
  id: number;
  uid: string;
  username: string;
  email: string;
  password_hash: string;
  role: UserRole;
  disabled: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: number;
  uid: string;
  login: string;
  username: string;
  email: string;
  role: UserRole;
  disabled: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}
