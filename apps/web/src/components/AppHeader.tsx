import { Link } from "@tanstack/react-router";
import { UserMenu } from "./UserMenu";
import { Logo } from "./common/logo/Logo";

/**
 * Simple app-level header for non-project pages (projects list, new project).
 * Project pages use the merged header in the $projectId layout instead.
 */
export function AppHeader() {
  return (
    <header className="border-b border-zinc-800 px-4 sm:px-8">
      <div className="flex items-center justify-between h-14">
        <Link
          to="/"
          className="flex items-center hover:opacity-80 transition-opacity"
        >
          <Logo className="size-5" />
        </Link>
        <UserMenu />
      </div>
    </header>
  );
}
