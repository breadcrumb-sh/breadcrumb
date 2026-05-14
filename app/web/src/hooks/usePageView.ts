import { useEffect } from "react";
import { capture } from "../lib/telemetry";

export function usePageView(pageType: string) {
  useEffect(() => {
    capture("page_viewed", { page_type: pageType });
  }, [pageType]);
}
