import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import type { ButtonVariant } from "./Button";

interface ConfirmOptions {
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Extract<ButtonVariant, "primary" | "destructive">;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Replaces the browser's blocking `confirm()` — which can't be styled, doesn't respect the
 * design system, and (per MASTER.md's accessibility checklist) has no visible focus state or
 * keyboard affordance beyond Enter/Escape. `useConfirm()` returns a promise, so call sites read
 * almost identically to the `confirm()` calls they replace. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function settle(value: boolean) {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={!!options} onClose={() => settle(false)} title={options?.title ?? ""}>
        {options?.message}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={() => settle(false)}>
            {options?.cancelLabel ?? "Cancel"}
          </Button>
          <Button variant={options?.variant ?? "primary"} size="sm" onClick={() => settle(true)} autoFocus>
            {options?.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm() must be used within <ConfirmProvider>");
  return ctx;
}
