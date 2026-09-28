/** Maps any caught error to a short, non-technical message safe to render
 * in the UI. The raw error (HTTP status, response body, API path, or a
 * Supabase/FastAPI message) is always logged via console.error for
 * developers -- it must never reach the DOM. */

export type ErrorContext =
  | "food-log-save"
  | "food-log-update"
  | "food-log-delete"
  | "food-search"
  | "food-create"
  | "diary-load"
  | "water-log"
  | "glass-size"
  | "coach-message"
  | "coach-history"
  | "goals-calculate"
  | "profile-save"
  | "profile-load"
  | "friends-search"
  | "friends-request"
  | "friends-respond"
  | "friends-load"
  | "leaderboard-load"
  | "activity-log"
  | "diet-plan"
  | "ai-calculate"
  | "notifications-save"
  | "notifications-load"
  | "progress-load"
  | "generic";

const MESSAGES: Record<ErrorContext, string> = {
  "food-log-save": "We couldn't save that food. Please try again.",
  "food-log-update": "We couldn't update that entry. Please try again.",
  "food-log-delete": "We couldn't remove that entry. Please try again.",
  "food-search": "We couldn't search for that food. Please try again.",
  "food-create": "We couldn't create that food. Please try again.",
  "diary-load": "We couldn't load today's diary. Please try again.",
  "water-log": "We couldn't update your water log. Please try again.",
  "glass-size": "We couldn't save that glass size. Please try again.",
  "coach-message": "Coach is having trouble responding right now. Please try again.",
  "coach-history": "We couldn't load your conversation with Coach. Please try again.",
  "goals-calculate": "We couldn't calculate your targets. Please try again.",
  "profile-save": "We couldn't save your changes. Please try again.",
  "profile-load": "We couldn't load your profile. Please try again.",
  "friends-search": "We couldn't search for that user. Please try again.",
  "friends-request": "We couldn't send that friend request. Please try again.",
  "friends-respond": "We couldn't update that request. Please try again.",
  "friends-load": "We couldn't load your friends. Please try again.",
  "leaderboard-load": "We couldn't load the leaderboard. Please try again.",
  "activity-log": "We couldn't save that activity. Please try again.",
  "diet-plan": "We couldn't generate a diet plan right now. Please try again.",
  "ai-calculate": "We couldn't work out what you ate. Please try again.",
  "notifications-save": "We couldn't save your notification settings. Please try again.",
  "notifications-load": "We couldn't load your notification settings. Please try again.",
  "progress-load": "We couldn't load your progress. Please try again.",
  generic: "Something went wrong. Please try again.",
};

/** Logs the real error for developers and returns a friendly, non-technical
 * message safe to render in the UI. Never include `err`'s message, an HTTP
 * status code, a response body, or an API path in the returned string. */
export function friendlyMessage(err: unknown, context: ErrorContext = "generic"): string {
  console.error(`[${context}]`, err);
  return MESSAGES[context];
}

const AUTH_MESSAGES: Record<string, string> = {
  "invalid login credentials": "That email or password doesn't look right. Please try again.",
  "email not confirmed": "Please confirm your email before signing in.",
  "user already registered": "An account with that email already exists. Try signing in instead.",
  "password should be at least": "Please choose a longer password.",
  "email rate limit exceeded": "Too many attempts. Please wait a moment and try again.",
  "invalid email": "That doesn't look like a valid email address.",
};

/** Same idea as friendlyMessage, specifically for Supabase Auth errors:
 * maps a small set of known, safe-to-explain cases to friendly wording and
 * otherwise falls back to a generic message -- never renders Supabase's
 * raw error string. */
export function friendlyAuthMessage(err: unknown, mode: "login" | "signup"): string {
  console.error(`[auth-${mode}]`, err);
  const raw = err instanceof Error ? err.message.toLowerCase() : "";
  for (const [needle, friendly] of Object.entries(AUTH_MESSAGES)) {
    if (raw.includes(needle)) return friendly;
  }
  return mode === "login"
    ? "We couldn't sign you in. Please check your details and try again."
    : "We couldn't create your account. Please try again.";
}
