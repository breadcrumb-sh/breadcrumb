import { useEffect } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";
import { identifyUserJot, initUserJot } from "../../lib/userjot";

export function UserJotBridge() {
  const { user } = useAuth();
  const { theme } = useTheme();

  useEffect(() => {
    void initUserJot(theme);
  }, [theme]);

  useEffect(() => {
    if (!user) {
      return;
    }

    void identifyUserJot({
      id: (user as { id?: string }).id,
      email: user.email,
      name: user.name,
      image: (user as { image?: string | null }).image,
    });
  }, [user]);

  return null;
}
