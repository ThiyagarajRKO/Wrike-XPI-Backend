import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./RowMenu.css";

/* The per-row "⋯" actions menu.
 *
 * Replaces an imperative openRowMenu() that built the menu with
 * document.createElement, wrote item labels through innerHTML, tracked the
 * open menu in a module-level variable, and registered its own document
 * listeners. Here the menu is ordinary React state, items are typed, and the
 * only DOM work left is measuring the trigger to position the panel.
 *
 * Rendered through a portal on <body> so table overflow can never clip it.
 * Only one can be open at a time because each trigger owns its own state and
 * closes on any outside pointerdown, including one on another trigger. */

export interface RowMenuItem {
  label: string;
  /** FontAwesome classes, e.g. "fa-solid fa-pen-to-square". */
  icon: string;
  danger?: boolean;
  onSelect: () => void;
}

interface Position {
  top: number;
  left: number;
}

const GAP = 6;
const EDGE = 8;

export function RowMenu({ items, label = "Actions" }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
    setActiveIndex(-1);
  }, []);

  /* Measure after paint but before the browser shows the frame, so the menu
     never appears at the wrong spot for one frame. */
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const anchor = trigger.getBoundingClientRect();
    const { width, height } = menu.getBoundingClientRect();

    // Prefer below the trigger; flip above when that would run off-screen.
    let top = anchor.bottom + GAP;
    if (top + height > window.innerHeight - EDGE) {
      top = Math.max(EDGE, anchor.top - height - GAP);
    }

    // Right-aligned to the trigger, clamped into the viewport.
    const left = Math.max(
      EDGE,
      Math.min(anchor.right - width, window.innerWidth - width - EDGE),
    );

    setPosition({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((current) => {
          const delta = e.key === "ArrowDown" ? 1 : -1;
          return (current + delta + items.length) % items.length;
        });
      }
    };

    // A scroll or resize invalidates the measured position; closing is
    // steadier than chasing the anchor on every frame.
    const onReflow = () => close();

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, close, items.length]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = menuRef.current?.querySelectorAll<HTMLButtonElement>(".row-menu-item")[activeIndex];
    node?.focus();
  }, [open, activeIndex]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`icon-btn row-menu-trigger${open ? " row-menu-open" : ""}`}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <i className="fa-solid fa-ellipsis-vertical" aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="row-menu"
            role="menu"
            aria-label={label}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              // Hidden until measured, so it can be sized off-screen without
              // the user seeing it land in the wrong place first.
              visibility: position ? "visible" : "hidden",
            }}
          >
            {items.map((item, index) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`row-menu-item${item.danger ? " danger" : ""}`}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                <i className={item.icon} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
