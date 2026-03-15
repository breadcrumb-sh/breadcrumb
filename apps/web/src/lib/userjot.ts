import type { Theme } from "../hooks/useTheme";

const USERJOT_PROJECT_ID = "cmmmah5da051v0imyvrh353q6";
const USERJOT_SDK_URL = "https://cdn.userjot.com/sdk/v2/uj.js";

type UserJotTheme = Theme | "auto";

type UserJotInitOptions = {
  widget?: boolean;
  trigger?: "default" | "custom";
  theme?: UserJotTheme;
};

type UserJotWidgetOptions = {
  section?: "feedback" | "roadmap" | "updates";
};

type UserJotApi = {
  init: (projectId: string, options?: UserJotInitOptions) => void;
  showWidget: (options?: UserJotWidgetOptions) => void;
  setTheme: (theme: UserJotTheme) => void;
};

declare global {
  interface Window {
    $ujq?: unknown[][];
    uj?: UserJotApi;
  }
}

let userJotLoader: Promise<void> | null = null;
let userJotInitialized = false;

function isLightTheme() {
  return document.documentElement.classList.contains("light");
}

function ensureUserJotProxy() {
  window.$ujq = window.$ujq ?? [];

  if (window.uj) {
    return;
  }

  window.uj = new Proxy({} as UserJotApi, {
    get: (_, property) => (...args: unknown[]) => {
      window.$ujq?.push([property, ...args]);
    },
  });
}

function loadUserJotSdk() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (userJotLoader) {
    return userJotLoader;
  }

  userJotLoader = new Promise((resolve, reject) => {
    ensureUserJotProxy();

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-userjot-sdk="true"]',
    );

    if (existingScript) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = USERJOT_SDK_URL;
    script.type = "module";
    script.async = true;
    script.dataset.userjotSdk = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load UserJot SDK"));
    document.head.appendChild(script);
  });

  return userJotLoader;
}

export async function initUserJot(theme: Theme) {
  await loadUserJotSdk();

  if (!window.uj) {
    return;
  }

  if (!userJotInitialized) {
    window.uj.init(USERJOT_PROJECT_ID, {
      widget: true,
      trigger: "custom",
      theme,
    });
    userJotInitialized = true;
    return;
  }

  window.uj.setTheme(theme);
}

export async function openUserJotFeedback() {
  await initUserJot(isLightTheme() ? "light" : "dark");
  window.uj?.showWidget({ section: "feedback" });
}
