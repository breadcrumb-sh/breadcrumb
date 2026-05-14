import { type ReactNode } from "react";
import { UserMenu } from "./UserMenu";

/**
 * Shared top header bar used across all pages.
 * Pass switchers/breadcrumbs as children on the left side.
 */
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="h-[52px] shrink-0 flex items-center justify-between border-b border-zinc-800/70 bg-zinc-950 px-6">
      <div className="flex items-center gap-1.5 text-[12px] min-w-0">
        {children}
      </div>
      <div className="flex items-center gap-3">
        <UserMenu />
      </div>
    </header>
  );
}
