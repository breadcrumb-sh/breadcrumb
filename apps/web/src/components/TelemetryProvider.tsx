import { useEffect, useRef } from "react";
import { trpc } from "../lib/trpc";
import { initPostHog, capture } from "../lib/telemetry";

export function TelemetryProvider() {
  const { data } = trpc.config.telemetry.useQuery();
  const initialized = useRef(false);

  useEffect(() => {
    if (data && !initialized.current) {
      initialized.current = true;
      initPostHog(data.disabled);
      capture("app_loaded");
    }
  }, [data]);

  return null;
}
