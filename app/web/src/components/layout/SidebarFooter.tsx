import { BookOpen } from "@phosphor-icons/react/BookOpen";
import { ChatCircleDots } from "@phosphor-icons/react/ChatCircleDots";
import { openUserJotFeedback } from "../../lib/userjot";

export function SidebarFooter() {
  return (
    <div className="px-2.5 py-2.5 space-y-0.5 border-t border-zinc-800/70">
      <button
        type="button"
        onClick={() => {
          void openUserJotFeedback();
        }}
        className="flex cursor-pointer items-center gap-2.5 w-full rounded-md px-3 py-1.5 text-[12px] text-zinc-400 hover:text-zinc-100 transition-colors duration-150"
      >
        <ChatCircleDots size={16} className="shrink-0 text-zinc-500" />
        Feedback
      </button>
      <a
        href="https://breadcrumb.sh/docs"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2.5 w-full rounded-md px-3 py-1.5 text-[12px] text-zinc-400 hover:text-zinc-100 transition-colors duration-150"
      >
        <BookOpen size={16} className="shrink-0 text-zinc-500" />
        Documentation
      </a>
    </div>
  );
}
