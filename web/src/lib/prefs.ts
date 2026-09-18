import { useCallback, useState, useSyncExternalStore } from "react";

const PREFIX = "tree-learn:";

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode: preferences just won't stick */
  }
}

/** useState that survives reloads. */
export function usePref<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readPref(key, fallback));
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        writePref(key, v);
        return v;
      }),
    [key],
  );
  return [value, set] as const;
}

export type ThemePref = "system" | "light" | "dark";

// One theme for the whole app, whoever changes it. Stored raw (not JSON) so the pre-paint script in index.html can read it.
const media = matchMedia("(prefers-color-scheme: light)");
let themePref: ThemePref = (localStorage.getItem(PREFIX + "theme") as ThemePref | null) ?? "system";
const themeListeners = new Set<() => void>();
function applyTheme() {
  document.documentElement.dataset.theme = themePref === "light" || (themePref === "system" && media.matches) ? "light" : "dark";
}
media.addEventListener("change", applyTheme);

export function setThemePref(next: ThemePref) {
  themePref = next;
  localStorage.setItem(PREFIX + "theme", next);
  applyTheme();
  themeListeners.forEach((l) => l());
}

export function useTheme() {
  const pref = useSyncExternalStore(
    (cb) => (themeListeners.add(cb), () => themeListeners.delete(cb)),
    () => themePref,
  );
  return [pref, setThemePref] as const;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";
export const ALT = isMac ? "⌥" : "Alt";
