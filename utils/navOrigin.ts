/**
 * Remembers the screen the user was on before the current one, so a screen that lives in a
 * different tab stack (the chat) can send Back to the true origin instead of its own tab root.
 * Updated from the root layout on every pathname change.
 */
let currentPath = '';
let previousPath = '';

export function trackPath(path: string) {
  if (!path || path === currentPath) return;
  previousPath = currentPath;
  currentPath = path;
}

/** Path of the screen the user is on right now. While a newly opened screen renders for the first
 *  time this is still the screen it was opened from. */
export function getCurrentPath() {
  return currentPath;
}

export function getPreviousPath() {
  return previousPath;
}
