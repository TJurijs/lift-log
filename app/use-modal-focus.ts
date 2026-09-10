import { useEffect, useEffectEvent, type RefObject } from "react";

const dialogs = new Set<HTMLElement>();
let previousOverflow = "";

/** Shared by regular forms and portal dialogs, including embedded video. */
export function useModalFocus(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled = true,
  dismissible = true,
) {
  const close = useEffectEvent(() => { if (dismissible) onClose(); });
  useEffect(() => {
    const dialog = ref.current;
    if (!enabled || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialogs.size) previousOverflow = document.body.style.overflow;
    dialogs.add(dialog);
    document.body.style.overflow = "hidden";
    const isTop = () => [...dialogs].at(-1) === dialog;
    const candidates = () => [...dialog.querySelectorAll<HTMLElement>(
      "a[href], button, input, select, textarea, summary, iframe, [tabindex]",
    )].filter(element => {
      if (element.tabIndex < 0 || element.matches(":disabled, input[type='hidden']") ||
        element.closest("[hidden], [inert]") || getComputedStyle(element).visibility === "hidden") return false;
      for (let parent: HTMLElement | null = element; parent && parent !== dialog; parent = parent.parentElement) {
        if (getComputedStyle(parent).display === "none") return false;
      }
      return true;
    });
    const initial = candidates();
    (initial.find(el => el.hasAttribute("data-modal-initial-focus")) ??
      initial.find(el => el.matches("input, select, textarea")) ?? dialog).focus();

    function keydown(event: KeyboardEvent) {
      if (!isTop()) return;
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const elements = candidates();
      const first = elements[0] ?? dialog!;
      const last = elements.at(-1) ?? dialog!;
      const focused = document.activeElement as HTMLElement;
      if (!elements.includes(focused) || (event.shiftKey ? focused === first : focused === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
    // Tab leaving a cross-origin iframe is not a key event in this document.
    // Catch the resulting focus transition as well as programmatic focus leaks.
    function focusin(event: FocusEvent) {
      if (isTop() && event.target instanceof Node && !dialog!.contains(event.target)) {
        (candidates()[0] ?? dialog!).focus();
      }
    }
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
      dialogs.delete(dialog);
      if (!dialogs.size) document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [enabled, ref]);
}
