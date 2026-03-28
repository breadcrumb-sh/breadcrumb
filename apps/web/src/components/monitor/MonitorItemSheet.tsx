import { useState, useRef } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Drawer } from "@base-ui/react/drawer";
import { DotsThree } from "@phosphor-icons/react/DotsThree";
import { EyeSlash } from "@phosphor-icons/react/EyeSlash";
import { Trash } from "@phosphor-icons/react/Trash";
import { X } from "@phosphor-icons/react/X";
import Markdown from "react-markdown";
import { useClickOutside } from "../../hooks/useClickOutside";
import { backdropCls, popupCls } from "../settings/dialog-styles";
import { statusInfo, formatTime } from "./columns";
import type { MonitorItem } from "./types";

export function MonitorItemSheet({
  item,
  open,
  onOpenChange,
  onDismiss,
  onDelete,
}: {
  item: MonitorItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setMenuOpen(false));

  if (!item) return null;

  const { label: statusText, dotColor, Icon: StatusIcon } = statusInfo(item.status);

  return (
    <>
      <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="right">
        <Drawer.Portal>
          <Drawer.Backdrop className="monitor-drawer-backdrop" />
          <Drawer.Viewport className="monitor-drawer-viewport">
            <Drawer.Popup className="monitor-drawer-popup">
              <Drawer.Content>
                <div className="sticky top-0 bg-zinc-950 border-b border-zinc-800 px-5 py-4 flex items-start justify-between gap-4 z-10">
                  <div className="min-w-0">
                    <Drawer.Title className="text-base font-semibold text-zinc-100">
                      {item.title}
                    </Drawer.Title>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                        <StatusIcon className={`size-3.5 ${dotColor}`} />
                        {statusText}
                      </span>
                      {item.dismissed && (
                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded border text-zinc-400 bg-zinc-400/10 border-zinc-400/20">
                          Dismissed
                        </span>
                      )}
                      <span className="text-xs text-zinc-500">{formatTime(item.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <div ref={menuRef} className="relative">
                      <button
                        onClick={() => setMenuOpen((o) => !o)}
                        className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                      >
                        <DotsThree size={16} weight="bold" />
                      </button>
                      {menuOpen && (
                        <div className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl py-1 z-50 motion-preset-fade motion-preset-slide-down-sm motion-duration-150">
                          <button
                            onClick={() => { setConfirmDismiss(true); setMenuOpen(false); }}
                            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors text-left"
                          >
                            <EyeSlash size={14} />
                            Dismiss
                          </button>
                          <button
                            onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}
                            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-zinc-800 transition-colors text-left"
                          >
                            <Trash size={14} />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                    <Drawer.Close className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">
                      <X size={16} weight="bold" />
                    </Drawer.Close>
                  </div>
                </div>

                <Drawer.Description render={<div />} className="px-5 py-5">
                  {item.description ? (
                    <div className="prose prose-sm prose-invert max-w-none text-zinc-300 [&_p]:leading-relaxed [&_li]:text-zinc-300 [&_a]:text-blue-400">
                      <Markdown>{item.description}</Markdown>
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-500">No description.</p>
                  )}
                </Drawer.Description>
              </Drawer.Content>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.Root>

      <AlertDialog.Root open={confirmDismiss} onOpenChange={setConfirmDismiss}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className={backdropCls} />
          <AlertDialog.Viewport className="fixed inset-0 z-[60] grid place-items-center px-4">
            <AlertDialog.Popup className={popupCls}>
              <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                Dismiss this item?
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                This will mark the item as dismissed and move it to Done.
              </AlertDialog.Description>
              <div className="flex justify-end gap-2">
                <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                  Cancel
                </AlertDialog.Close>
                <AlertDialog.Close
                  onClick={onDismiss}
                  className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors"
                >
                  Dismiss
                </AlertDialog.Close>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className={backdropCls} />
          <AlertDialog.Viewport className="fixed inset-0 z-[60] grid place-items-center px-4">
            <AlertDialog.Popup className={popupCls}>
              <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                Delete this item?
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                This action cannot be undone.
              </AlertDialog.Description>
              <div className="flex justify-end gap-2">
                <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                  Cancel
                </AlertDialog.Close>
                <AlertDialog.Close
                  onClick={onDelete}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                >
                  Delete
                </AlertDialog.Close>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
