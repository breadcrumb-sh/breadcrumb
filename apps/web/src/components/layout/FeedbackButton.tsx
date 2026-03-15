import { ChatCircleDots } from "@phosphor-icons/react/ChatCircleDots";
import { openUserJotFeedback } from "../../lib/userjot";

export function FeedbackButton() {
  return (
    <button
      type="button"
      onClick={() => {
        void openUserJotFeedback();
      }}
      aria-label="Feedback"
      title="Give feedback"
      className="hidden h-8 items-center gap-2 px-1 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-100 sm:inline-flex"
    >
      <ChatCircleDots size={15} weight="bold" />
      <span className="hidden sm:inline">Feedback</span>
    </button>
  );
}
