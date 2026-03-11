import { ChatCircleDots } from "@phosphor-icons/react";

export function FeedbackButton() {
  return (
    <button
      type="button"
      aria-label="Feedback"
      title="Feedback coming soon"
      className="inline-flex h-8 items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
    >
      <ChatCircleDots size={15} weight="bold" />
      <span className="hidden sm:inline">Feedback</span>
    </button>
  );
}
