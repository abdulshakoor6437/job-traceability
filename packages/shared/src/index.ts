export interface User {
  id: string;
  email: string;
  is_verified: boolean;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  id: string;
  user_id: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  message: string;
  user?: User;
}

export interface ActiveSignalResponse {
  userId: string;
  lastActiveAt: string | null;
  isActive: boolean;
}

export interface UpdateSettingsRequest {
  timezone: string;
}

export interface GenericMessageResponse {
  message: string;
}
