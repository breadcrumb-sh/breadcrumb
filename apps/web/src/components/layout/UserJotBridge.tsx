import { useEffect } from "react";
import { useTheme } from "../../hooks/useTheme";
import { initUserJot } from "../../lib/userjot";

export function UserJotBridge() {
  const { theme } = useTheme();

  useEffect(() => {
    void initUserJot(theme);
  }, [theme]);

  return null;
}
