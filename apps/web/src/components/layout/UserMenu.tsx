import { useRef, useState, useCallback } from "react";
import { SignOut } from "@phosphor-icons/react/SignOut";
import { Gear } from "@phosphor-icons/react/Gear";
import { ChatCircleDots } from "@phosphor-icons/react/ChatCircleDots";
import { Link, useNavigate } from "@tanstack/react-router";
import { useClickOutside } from "../../hooks/useClickOutside";
import { authClient } from "../../lib/auth-client";
import { openUserJotFeedback } from "../../lib/userjot";
import { useAuth } from "../../hooks/useAuth";

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    return null;
  }

  const closeMenu = useCallback(() => setOpen(false), []);
  useClickOutside(containerRef, closeMenu);

  const handleLogout = () => {
    authClient.signOut().then(() => navigate({ to: "/login" }));
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="User menu"
        className="flex items-center justify-center size-8 overflow-hidden hover:opacity-80 transition-opacity"
      >
        <div className="size-8 bg-zinc-800/50 flex items-center justify-center text-xs font-medium text-zinc-300">
          {(user?.name ?? user?.email ?? "U").charAt(0).toUpperCase()}
        </div>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-44 rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl z-[100] overflow-hidden py-1.5 motion-preset-fade motion-preset-slide-down-sm motion-duration-150">
          <button
            type="button"
            title="Give feedback"
            onClick={() => {
              void openUserJotFeedback();
              setOpen(false);
            }}
            className="flex sm:hidden items-center gap-3 w-full px-3.5 py-2.5 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors text-left"
          >
            <ChatCircleDots size={14} weight="bold" />
            Feedback
          </button>

          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 w-full px-3.5 py-2.5 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors text-left"
          >
            <Gear size={14} weight="bold" />
            Settings
          </Link>

          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3.5 py-2.5 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors text-left"
          >
            <SignOut size={14} weight="bold" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
