const BASE = "/api";

function getPin(): string | null {
  return sessionStorage.getItem("pin");
}

function headers(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const pin = getPin();
  if (pin) h["x-auth-pin"] = pin;
  return h;
}

function authHeaders(): HeadersInit {
  const h: Record<string, string> = {};
  const pin = getPin();
  if (pin) h["x-auth-pin"] = pin;
  return h;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    sessionStorage.removeItem("pin");
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
  async get<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, { headers: headers() });
    return handleResponse<T>(res);
  },

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: "PUT",
      headers: headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  async del<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: "DELETE",
      headers: headers(),
    });
    return handleResponse<T>(res);
  },

  async upload<T = unknown>(path: string, formData: FormData): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    });
    return handleResponse<T>(res);
  },
};
