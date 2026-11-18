const KEY = "market-diagnostic:wsb-reader";
const KEY_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const UNLOCK_PREFIX = "#wsb-unlock=";
export const WSB_UNLOCK_EVENT = "wsb-reader-unlocked";
let temporaryKey = "";

export function captureWsbUnlock() {
  if (window.location.pathname !== "/news" || !window.location.hash.startsWith(UNLOCK_PREFIX)) return;
  const key = window.location.hash.slice(UNLOCK_PREFIX.length);
  window.history.replaceState(window.history.state, "", `/news${window.location.search}#wsb-discussion`);
  if (!KEY_FORMAT.test(key)) return;
  temporaryKey = key;
  try {
    window.localStorage.setItem(KEY, key);
  } catch {
    // The reader can still be used for this visit.
  }
  window.dispatchEvent(new Event(WSB_UNLOCK_EVENT));
}

export function redactWsbUnlockPath(path: string) {
  const index = path.indexOf(UNLOCK_PREFIX);
  return index < 0 ? path : path.slice(0, index) + "#wsb-discussion";
}

export function readWsbKey() {
  try {
    const key = window.localStorage.getItem(KEY) ?? "";
    if (KEY_FORMAT.test(key)) return key;
  } catch {
    // Use the key captured for this visit.
  }
  return temporaryKey;
}

export function clearWsbKey() {
  temporaryKey = "";
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // The in-memory key is already cleared.
  }
}
