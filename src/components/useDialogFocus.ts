import { useRef, type RefObject } from "react";

export function useDialogFocus(
  returnFocus?: HTMLElement | RefObject<HTMLElement | null> | null,
) {
  const previousFocus = useRef<HTMLElement | null>(null);

  return {
    onOpenAutoFocus() {
      const active = document.activeElement;
      previousFocus.current = active instanceof HTMLElement ? active : null;
    },
    onCloseAutoFocus(event: Event) {
      const trigger =
        returnFocus && "current" in returnFocus
          ? returnFocus.current
          : returnFocus;
      const target = trigger?.isConnected ? trigger : previousFocus.current;
      if (target?.isConnected) {
        event.preventDefault();
        target.focus({ preventScroll: true });
      }
    },
  };
}
