import { useRef, useState, useEffect } from "react";
import { Sun, Moon, SignOut, Gear } from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const handleLogout = () => {
    authClient.signOut().then(() => navigate({ to: "/login" }));
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="User menu"
        className="flex items-center justify-center size-8 rounded-full overflow-hidden hover:opacity-80 transition-opacity"
      >
        <div className="size-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-medium text-zinc-300">
          {(user?.name ?? user?.email ?? "U").charAt(0).toUpperCase()}
        </div>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-44 rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl z-50 overflow-hidden py-1.5">
          <button
            onClick={() => { toggle(); setOpen(false); }}
            className="flex items-center gap-3 w-full px-3.5 py-2.5 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors text-left"
          >
            {theme === "dark"
              ? <Sun size={14} weight="bold" />
              : <Moon size={14} weight="bold" />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>

          <div className="my-1 border-t border-zinc-800" />

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
