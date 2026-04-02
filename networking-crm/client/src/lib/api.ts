const BASE = "/api";

interface RequestOptions {
  signal?: AbortSignal;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    sessionStorage.removeItem("authed");
    window.location.reload();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  async get<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      signal: opts?.signal,
    });
    return handleResponse<T>(res);
  },

  async post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts?.signal,
    });
    return handleResponse<T>(res);
  },

  async put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts?.signal,
    });
    return handleResponse<T>(res);
  },

  async del<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      signal: opts?.signal,
    });
    return handleResponse<T>(res);
  },

  async upload<T = unknown>(path: string, formData: FormData, opts?: RequestOptions): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      credentials: "same-origin",
      body: formData,
      signal: opts?.signal,
    });
    return handleResponse<T>(res);
  },
};
