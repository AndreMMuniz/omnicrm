/** File upload API */

import { getToken } from "@/lib/api";

const BASE = "/api/v1";

export async function uploadFile(file: File | Blob, filename?: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", file, filename);

  const token = getToken();
  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    body: formData,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error?.message ?? "Upload failed");
  }
  // Unwrap {data: {url}} envelope
  const url: string = json?.data?.url ?? json?.url;
  if (!url) throw new Error("No URL in upload response");
  return url;
}
