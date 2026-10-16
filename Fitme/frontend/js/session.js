import { refreshAccess, request, setAccessToken } from "./api.js";

const listeners = new Set();
const state = { user: null, profile: null, ready: false };

export function getSession() {
  return state;
}

export function isAuthenticated() {
  return Boolean(state.user);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener(state);
}

async function loadProfile() {
  const profile = await request("/api/profile/");
  state.profile = profile;
  state.user = { id: profile.id, username: profile.username, email: profile.email };
}

/** On page load: try to resume using the HttpOnly refresh cookie. */
export async function restore() {
  try {
    if (await refreshAccess()) await loadProfile();
  } catch {
    clearLocal();
  }
  state.ready = true;
  emit();
}

export async function login(username, password) {
  const data = await request("/api/auth/token/", { method: "POST", body: { username, password }, auth: false });
  setAccessToken(data.access);
  await loadProfile();
  emit();
}

export async function register(username, email, password) {
  const data = await request("/api/auth/register/", {
    method: "POST",
    body: { username, email, password },
    auth: false,
  });
  setAccessToken(data.access);
  await loadProfile();
  emit();
}

export async function logout() {
  try {
    await request("/api/auth/logout/", { method: "POST", auth: false });
  } finally {
    clearLocal();
    emit();
  }
}

export function setProfile(profile) {
  state.profile = profile;
  state.user = { id: profile.id, username: profile.username, email: profile.email };
  emit();
}

export function clearLocal() {
  setAccessToken(null);
  state.user = null;
  state.profile = null;
}

export function expire() {
  if (!state.user) return;
  clearLocal();
  emit();
}
