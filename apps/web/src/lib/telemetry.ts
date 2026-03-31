import posthog from "posthog-js";

const POSTHOG_KEY = "phc_lea3h9RaPbSwQzz2e9AF32oXnLt3O3MnDTO6uZuRm07";

let enabled = false;

function getTheme(): "dark" | "light" {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

export function initPostHog(disabled: boolean, instanceId?: string | null) {
  if (disabled) return;

  const URL_PROPS = [
    "$current_url",
    "$pathname",
    "$referrer",
    "$referring_domain",
    "$initial_current_url",
    "$initial_pathname",
    "$initial_referrer",
    "$initial_referring_domain",
  ];

  posthog.init(POSTHOG_KEY, {
    api_host: `${window.location.origin}/ext`,
    ui_host: "https://eu.posthog.com",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    persistence: "memory",
    ip: false,
    property_denylist: ["$ip", ...URL_PROPS],
    sanitize_properties(properties) {
      for (const key of URL_PROPS) {
        delete properties[key];
      }
      return properties;
    },
  });

  if (instanceId) {
    posthog.identify(instanceId);
  }

  enabled = true;
}

export function capture(
  event: string,
  properties?: Record<string, unknown>,
) {
  if (!enabled) return;
  posthog.capture(event, { theme: getTheme(), ...properties });
}
