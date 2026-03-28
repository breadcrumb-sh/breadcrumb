import { type ReactNode } from "react";
import { FeedbackButton } from "./FeedbackButton";
import { UserMenu } from "./UserMenu";

/**
 * Shared top header bar used across all pages.
 * Pass switchers/breadcrumbs as children on the left side.
 */
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="h-12 shrink-0 flex items-center justify-between border-b border-zinc-800/70 bg-zinc-950 px-4 sm:px-5">
      <div className="flex items-center gap-1.5 text-sm min-w-0">
        {children}
      </div>
      <div className="flex items-center gap-3">
        <FeedbackButton />
        <UserMenu />
      </div>
    </header>
  );
}
