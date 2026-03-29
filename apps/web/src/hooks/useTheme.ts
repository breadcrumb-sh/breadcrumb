import { useState, useEffect } from "react";

export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

function getPreference(): ThemePreference {
  return (localStorage.getItem("theme") as ThemePreference) ?? "system";
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return pref;
}

function applyTheme(resolved: ResolvedTheme) {
  if (resolved === "light") {
    document.documentElement.classList.add("light");
  } else {
    document.documentElement.classList.remove("light");
  }
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(getPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(getPreference())
  );

  useEffect(() => {
    const sync = () => {
      const pref = getPreference();
      setPreference(pref);
      setResolved(resolveTheme(pref));
    };
    window.addEventListener("theme-change", sync);
    return () => window.removeEventListener("theme-change", sync);
  }, []);

  // Listen for OS theme changes when preference is "system"
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => {
      const next = resolveTheme("system");
      applyTheme(next);
      setResolved(next);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [preference]);

  const setTheme = (next: ThemePreference) => {
    if (next === "system") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", next);
    }
    const res = resolveTheme(next);
    applyTheme(res);
    setPreference(next);
    setResolved(res);
    window.dispatchEvent(new Event("theme-change"));
  };

  return { theme: resolved, preference, setTheme };
}
