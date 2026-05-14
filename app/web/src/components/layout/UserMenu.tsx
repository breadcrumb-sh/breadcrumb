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
        className="flex cursor-pointer items-center justify-center size-8 overflow-hidden hover:opacity-80 transition-opacity"
      >
        <div className="size-8 rounded-full bg-zinc-800/50 flex items-center justify-center text-xs font-medium text-zinc-300">
          {(user?.name ?? user?.email ?? "U").charAt(0).toUpperCase()}
        </div>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-44 rounded-lg border border-zinc-800/70 bg-zinc-950 shadow-xl z-[100] p-1">
          <button
            type="button"
            title="Give feedback"
            onClick={() => {
              void openUserJotFeedback();
              setOpen(false);
            }}
            className="flex cursor-pointer sm:hidden items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-[12px] text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors text-left"
          >
            <ChatCircleDots size={13} className="shrink-0 text-zinc-500" />
            Feedback
          </button>

          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex cursor-pointer items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-[12px] text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors text-left"
          >
            <Gear size={13} className="shrink-0 text-zinc-500" />
            Settings
          </Link>

          <div className="-mx-1 my-1 border-t border-zinc-800/70" />

          <button
            onClick={handleLogout}
            className="flex cursor-pointer items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-[12px] text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors text-left"
          >
            <SignOut size={13} className="shrink-0 text-zinc-500" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
