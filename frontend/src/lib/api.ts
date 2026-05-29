const BASE = "/api/v1";

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser<T = unknown>(): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const u = localStorage.getItem(USER_KEY);
    return u ? (JSON.parse(u) as T) : null;
  } catch {
    return null;
  }
}

export function setAuth(accessToken: string, _refreshToken: string, user: object) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string>) || {}),
    },
  });
}

export * as authApi from "./api/auth";
export * as conversationsApi from "./api/conversations";
export * as usersApi from "./api/users";
export * as userTypesApi from "./api/userTypes";
export * as settingsApi from "./api/settings";
export * as dashboardApi from "./api/dashboard";
export * as uploadApi from "./api/upload";
export * as aiApi from "./api/ai";
export * as quickRepliesApi from "./api/quickReplies";
export * as auditApi from "./api/audit";
export * as projectsApi from "./api/projects";
export * as catalogApi from "./api/catalog";
export * as proposalsApi from "./api/proposals";
export * as clientsApi from "./api/clients";
