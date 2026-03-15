import { Toast } from "@base-ui/react/toast";
import { X } from "@phosphor-icons/react/X";

interface ToastData {
  linkText?: string;
  linkHref?: string;
}

function ToastList() {
  const { toasts } = Toast.useToastManager<ToastData>();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="relative w-full rounded-lg border border-zinc-700 bg-zinc-900 p-4 pr-9 shadow-lg mb-2 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 data-[starting-style]:translate-y-2 transition-all duration-200"
    >
      <Toast.Content>
        {toast.title && (
          <Toast.Title className="text-sm font-medium text-zinc-100" />
        )}
        {toast.description && (
          <Toast.Description className="text-sm text-zinc-400 mt-0.5" />
        )}
        {toast.data?.linkText && toast.data.linkHref && (
          <a
            href={toast.data.linkHref}
            className="inline-block mt-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {toast.data.linkText} &rarr;
          </a>
        )}
        <Toast.Close
          className="absolute top-3 right-3 rounded p-0.5 text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label="Close"
        >
          <X size={14} />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider timeout={6000}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed z-50 bottom-4 right-4 flex flex-col w-[340px]">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

export const useToastManager = Toast.useToastManager<ToastData>;
