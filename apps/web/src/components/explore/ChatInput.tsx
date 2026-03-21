import { CircleNotch } from "@phosphor-icons/react/CircleNotch";
import { PaperPlaneTilt } from "@phosphor-icons/react/PaperPlaneTilt";
import { forwardRef } from "react";

type Props = {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
  streaming?: boolean;
  iconSize?: number;
  className?: string;
};

export const ChatInput = forwardRef<HTMLTextAreaElement, Props>(
  function ChatInput(
    {
      value,
      onChange,
      onKeyDown,
      onSend,
      placeholder = "Ask about your traces...",
      disabled = false,
      streaming = false,
      iconSize = 14,
      className,
    },
    ref,
  ) {
    return (
      <div
        className={`flex items-end gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 focus-within:border-zinc-600 transition-colors ${className ?? ""}`}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled || streaming}
          rows={1}
          className="flex-1 resize-none overflow-hidden bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={onSend}
          disabled={streaming || !value.trim()}
          className="shrink-0 p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {streaming ? (
            <CircleNotch size={iconSize} className="animate-spin" />
          ) : (
            <PaperPlaneTilt size={iconSize} />
          )}
        </button>
      </div>
    );
  },
);
