/** Auth API — login, logout, signup, password reset */

import { apiFetch, setAuth, clearAuth } from "@/lib/api";
import type { AuthPayload } from "@/types/auth";

const BASE = "/api/v1";

/**
 * Extract human-readable error message from FastAPI responses.
 *
 * FastAPI error shapes:
 *   Our custom:  {error: {message: "..."}}
 *   HTTPException with dict detail: {detail: {error: {message: "..."}}}
 *   HTTPException with string detail: {detail: "..."}
 */
function extractError(json: unknown, fallback: string): string {
  if (!json || typeof json !== "object") return fallback;
  const j = json as Record<string, unknown>;
  // Our envelope format: {error: {message}}
  if (typeof (j.error as Record<string,unknown>)?.message === "string")
    return (j.error as Record<string,unknown>).message as string;
  // FastAPI HTTPException with dict detail: {detail: {error: {message}}}
  if (j.detail && typeof j.detail === "object") {
    const d = j.detail as Record<string, unknown>;
    if (typeof (d.error as Record<string,unknown>)?.message === "string")
      return (d.error as Record<string,unknown>).message as string;
  }
  // FastAPI HTTPException with string detail
  if (typeof j.detail === "string") return j.detail;
  return fallback;
}

export async function login(email: string, password: string): Promise<AuthPayload> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractError(json, "Invalid email or password"));
  }
  const payload: AuthPayload = json?.data ?? json;
  if (!payload?.access_token) throw new Error("No token received");
  setAuth(payload.access_token, payload.refresh_token, payload.user);
  return payload;
}

export async function logout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
  clearAuth();
}

export async function signup(data: {
  email: string;
  password: string;
  full_name: string;
}): Promise<void> {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractError(json, "Signup failed"));
  }
}

export async function forgotPassword(email: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractError(json, "Failed to send reset email"));
  }
}

export async function setPassword(token: string, newPassword: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/set-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ new_password: newPassword }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractError(json, "Failed to set password"));
  }
}
