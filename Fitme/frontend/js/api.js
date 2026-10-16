/**
 * Single API client for FitMe.ai.
 *
 * Token handling:
 *  - The access token lives only in this module's memory (never localStorage).
 *  - The refresh token is an HttpOnly cookie the browser sends to /api/auth/*;
 *    JavaScript cannot read it. Requests identify as the web client with
 *    `X-FitMe-Client: web`, which the server requires for cookie refresh.
 *  - On a 401 the client refreshes once (shared across concurrent calls) and
 *    retries; if that fails the session-expired handler runs.
 *
 * This limits what an XSS bug could steal (no long-lived token in storage), but
 * script running on the page could still call the API while it runs. Keeping
 * untrusted content out of innerHTML is the main defence.
 */

const WEB_HEADER = { "X-FitMe-Client": "web" };

let accessToken = null;
let refreshInFlight = null;
let sessionExpiredHandler = () => {};

export class ApiError extends Error {
  constructor({ status = 0, code = "error", message = "Something went wrong.", fields = null, data = null }) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.data = data;
  }
}

export function setAccessToken(token) {
  accessToken = token || null;
}

export function hasAccessToken() {
  return Boolean(accessToken);
}

export function onSessionExpired(handler) {
  sessionExpiredHandler = handler;
}

const FALLBACK_MESSAGES = {
  0: "Can't reach FitMe.ai. Check your connection and try again.",
  401: "Your session has ended. Please sign in again.",
  403: "You don't have access to that.",
  404: "We couldn't find that.",
  413: "That file is too large.",
  429: "Too many requests. Please wait a moment and try again.",
  500: "Something went wrong on our side. Please try again.",
  502: "The styling service had a problem. Please try again.",
  503: "The service is temporarily unavailable.",
  504: "The styling service took too long to respond.",
};

/** Turn any response body into an ApiError with a human message. */
export function normalizeError(status, data) {
  const err = data && typeof data === "object" ? data.error : null;
  return new ApiError({
    status,
    code: err?.code || (status ? `http_${status}` : "network_error"),
    message: err?.message || FALLBACK_MESSAGES[status] || FALLBACK_MESSAGES[500],
    fields: err?.fields || null,
    data,
  });
}

async function parseBody(response) {
  if (response.status === 204) return null;
  const type = response.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Refresh the access token via the HttpOnly cookie. Returns true on success. */
export function refreshAccess() {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/token/refresh/", {
      method: "POST",
      credentials: "same-origin",
      headers: WEB_HEADER,
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const body = await parseBody(response);
        setAccessToken(body?.access);
        return Boolean(body?.access);
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

function buildHeaders(auth, extra = {}) {
  const headers = { ...WEB_HEADER, Accept: "application/json", ...extra };
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

/**
 * JSON request helper.
 * @param {string} path
 * @param {{method?: string, body?: any, auth?: boolean, signal?: AbortSignal, raw?: boolean}} options
 */
export async function request(path, { method = "GET", body, auth = true, signal, raw = false } = {}) {
  const isForm = body instanceof FormData;
  const send = () =>
    fetch(path, {
      method,
      signal,
      credentials: "same-origin",
      headers: buildHeaders(auth, body && !isForm ? { "Content-Type": "application/json" } : {}),
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });

  let response;
  try {
    response = await send();
    if (response.status === 401 && auth) {
      if (await refreshAccess()) {
        response = await send();
      }
      if (response.status === 401) {
        setAccessToken(null);
        sessionExpiredHandler();
      }
    }
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw normalizeError(0, null);
  }

  if (raw && response.ok) return response;
  const data = raw ? null : await parseBody(response);
  if (!response.ok) throw normalizeError(response.status, data ?? (raw ? await parseBody(response) : null));
  return data;
}

/** Fetch a protected image and return an object URL. Caller must revoke it. */
export async function fetchImageUrl(path, { signal } = {}) {
  const response = await request(path, { signal, raw: true });
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Multipart upload with progress (XHR exposes upload progress; fetch does not).
 * Resolves with { status, data } for 2xx; rejects with ApiError otherwise.
 */
export function upload(path, formData, { onProgress, onUploaded, signal } = {}) {
  const attempt = () =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", path);
      xhr.withCredentials = true;
      xhr.timeout = 180000;
      for (const [key, value] of Object.entries(buildHeaders(true))) xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
      };
      xhr.upload.onload = () => onUploaded?.();
      xhr.onload = () => {
        let data = null;
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          data = null;
        }
        resolve({ status: xhr.status, data });
      };
      xhr.onerror = () => reject(normalizeError(0, null));
      xhr.ontimeout = () => reject(new ApiError({ status: 0, code: "timeout", message: FALLBACK_MESSAGES[504] }));
      xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(formData);
    });

  return (async () => {
    let result = await attempt();
    if (result.status === 401 && (await refreshAccess())) {
      result = await attempt();
    }
    if (result.status === 401) {
      setAccessToken(null);
      sessionExpiredHandler();
    }
    if (result.status >= 200 && result.status < 300) return result.data;
    throw normalizeError(result.status, result.data);
  })();
}
