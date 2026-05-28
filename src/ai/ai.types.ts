export interface AiGroupRow {
  uid: string;
  slug: string;
  label: string;
  role: string;
  color: string;
  free: number;
  position: number;
  api_key_env_var: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiVariantRow {
  uid: string;
  group_uid: string;
  slug: string;
  provider_model_id: string;
  label: string;
  is_default: number;
  position: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
