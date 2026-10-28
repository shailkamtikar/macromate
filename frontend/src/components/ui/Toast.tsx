"use client";

import { AnimatePresence, m } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ease } from "@/components/ui/motion";

interface ToastItem {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Runs when the toast goes away WITHOUT the action being used. */
  onExpire?: () => void;
  duration: number;
}

interface ToastApi {
  show: (
    message: string,
    options?: {
      actionLabel?: string;
      onAction?: () => void;
      onExpire?: () => void;
      duration?: number;
    },
  ) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Brief confirmations with an optional action ("Undo"). Used for deletes:
 * the entry disappears immediately, and the real delete is only committed
 * when the toast expires without Undo being pressed. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const itemsRef = useRef<ToastItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const dismiss = useCallback((id: number, used: boolean) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    const item = itemsRef.current.find((t) => t.id === id);
    setItems((prev) => prev.filter((t) => t.id !== id));
    if (item && !used) item.onExpire?.();
  }, []);

  const show = useCallback<ToastApi["show"]>(
    (message, options = {}) => {
      const id = nextId.current++;
      const item: ToastItem = {
        id,
        message,
        actionLabel: options.actionLabel,
        onAction: options.onAction,
        onExpire: options.onExpire,
        duration: options.duration ?? 5000,
      };
      itemsRef.current = [...itemsRef.current, item];
      setItems((prev) => [...prev.slice(-2), item]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id, false), item.duration),
      );
    },
    [dismiss],
  );

  // Pending expirations must still run if the whole app unmounts (e.g. the
  // user closes the tab/navigates away): flush them so a "deleted" entry is
  // really deleted.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const [id, timer] of pending) {
        clearTimeout(timer);
        itemsRef.current.find((t) => t.id === id)?.onExpire?.();
      }
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-8"
      >
        <AnimatePresence>
          {items.map((t) => (
            <m.div
              key={t.id}
              layout
              role="status"
              data-testid="toast"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.25, ease: ease.out }}
              className="card pointer-events-auto flex items-center gap-4 px-4 py-3 text-sm text-on-surface"
            >
              <span>{t.message}</span>
              {t.actionLabel && (
                <button
                  type="button"
                  onClick={() => {
                    t.onAction?.();
                    dismiss(t.id, true);
                  }}
                  className="font-semibold text-primary"
                >
                  {t.actionLabel}
                </button>
              )}
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
