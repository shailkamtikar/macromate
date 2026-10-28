import { getAccessToken } from "@/lib/SessionProvider";

if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_API_URL) {
  // A production build silently falling back to localhost would call the
  // visitor's own machine -- fail the build loudly instead.
  throw new Error("NEXT_PUBLIC_API_URL must be set for production builds");
}
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Two separate request classes: plain data calls must answer quickly, while
// AI calls (Gemini) are legitimately slow. Keeping their budgets apart means
// a slow AI endpoint can never make an ordinary data call wait or fail, and
// the UI gets a clear timeout error for each instead of hanging.
const DATA_TIMEOUT_MS = 15_000;
const AI_TIMEOUT_MS = 40_000;

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // Reads the token SessionProvider already keeps current, instead of
  // independently awaiting supabase.auth.getSession() on every call -- see
  // the comment on getAccessToken in lib/SessionProvider.tsx.
  const token = getAccessToken();
  if (!token) {
    throw new ApiError("Not signed in", 401);
  }
  const timeoutMs = path.startsWith("/api/ai/") ? AI_TIMEOUT_MS : DATA_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError(`${path} timed out after ${timeoutMs} ms`, 408);
    }
    throw err;
  }
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(`${path} failed (${res.status}): ${body}`, res.status);
  }
  return res;
}

