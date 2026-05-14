import { CheckIcon } from "@phosphor-icons/react/Check";

interface Step {
  label: string;
}

export function StepIndicator({
  steps,
  current,
}: {
  steps: Step[];
  current: number;
}) {
  return (
    <div className="flex items-center gap-3">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center gap-3">
          {i > 0 && (
            <div
              className={`h-px w-8 ${i <= current ? "bg-zinc-600" : "bg-zinc-800"}`}
            />
          )}
          <div className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                i < current
                  ? "bg-emerald-500/20 text-emerald-400"
                  : i === current
                    ? "bg-zinc-100 text-zinc-900"
                    : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {i < current ? <CheckIcon size={12} weight="bold" /> : i + 1}
            </div>
            <span
              className={`text-sm ${
                i <= current ? "text-zinc-200" : "text-zinc-500"
              }`}
            >
              {step.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
