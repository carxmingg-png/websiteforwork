export interface KeyData {
  type: "user" | "admin";
  created_at: number;
  expires_at: number | null;
  claimed_users: string[];
  claimed_by: string | null;
  max_claims: number;
  duration_unit: string;
  duration_val: number | null;
  credits?: number;
  tokens?: number;
  out_of_credits?: boolean;
  out_of_tokens?: boolean;
  enabled_features?: string[];
}

export function resolveKeyCredits(keyData: { credits?: number; tokens?: number }): number {
  if (keyData.credits !== undefined) return keyData.credits;
  if (keyData.tokens !== undefined) return keyData.tokens;
  return 10;
}

export function isKeyOutOfCredits(keyData: { out_of_credits?: boolean; out_of_tokens?: boolean }): boolean {
  return !!(keyData.out_of_credits || keyData.out_of_tokens);
}

export function resolveApiCredits(data: { credits?: number; tokens?: number; role?: string }): number {
  if (data.credits !== undefined) return data.credits;
  if (data.tokens !== undefined) return data.tokens;
  return data.role === "owner" ? -1 : 10;
}

export interface BulkAccountResult {
  email: string;
  status: "success" | "failed";
  message?: string;
  password?: string;
  user_id?: string;
}

export interface BulkJobStatus {
  status: "idle" | "running" | "completed" | "cancelled";
  progress: number;
  total: number;
  logs: string[];
  results: BulkAccountResult[];
}

export interface BulkAccount {
  email: string;
  password?: string;
  status: string;
  user_id?: string;
  message?: string;
}

export interface UserSession {
  role: "owner" | "admin" | "user" | null;
  sessionToken?: string;
  expiry?: string;
}

export interface ProfileStats {
  cash: number;
  gold: number;
  level: number;
  exp: number;
  name: string | null;
  avatar: string | null;
  lastUpdated: string | null; // date_time from CarX profile
  isVerified: boolean;
}

export interface CarXAccount {
  email: string;
  password?: string;
  token?: string;
  user_id?: string;
  deviceId?: string;
  uniqueId?: string;
  unipId?: string;
  profileStats?: ProfileStats;
  statsFetchedAt?: number; // unix ms timestamp of last fetch
}

