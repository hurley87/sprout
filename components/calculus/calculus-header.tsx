"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./calculus-header.module.css";

export type CalculusProgressSegment = "done" | "current" | "next" | "skip";

export type CalculusHeaderProps = {
  progress: readonly CalculusProgressSegment[];
  label: string;
  showStuck: boolean;
  stuckDisabled: boolean;
  onHint: () => void;
  onRepeat: () => void;
  onSkip: () => void;
};

function StuckMenu({
  stuckDisabled,
  onHint,
  onRepeat,
  onSkip,
}: Pick<CalculusHeaderProps, "stuckDisabled" | "onHint" | "onRepeat" | "onSkip">) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const triggerId = useId();
  const noteId = useId();
  const items = [
    { label: "Give me a hint", glyph: "✦", onSelect: onHint },
    { label: "Repeat the problem", glyph: "↺", onSelect: onRepeat },
    { label: "Skip to next", glyph: "→", onSelect: onSkip },
  ];

  useEffect(() => {
    if (!open) return;

    itemRefs.current[0]?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = itemRefs.current.findIndex(item => item === document.activeElement);
    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % items.length;
        break;
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + items.length) % items.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    itemRefs.current[nextIndex]?.focus();
  }

  return (
    <div
      ref={containerRef}
      className={styles.stuck}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={styles.trigger}
        aria-label="Stuck? Hint, repeat or skip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true" className={styles.questionMark}>
          ?
        </span>
        <span className={styles.triggerText}>Stuck?</span>
      </button>
      {open && (
        <div className={styles.dropdown}>
          <div
            id={menuId}
            role="menu"
            aria-labelledby={triggerId}
            aria-describedby={noteId}
            className={styles.menu}
            onKeyDown={handleMenuKeyDown}
          >
            {items.map((item, index) => (
              <button
                key={item.label}
                ref={element => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={stuckDisabled}
                className={styles.menuItem}
                onClick={() => {
                  if (stuckDisabled) return;
                  setOpen(false);
                  triggerRef.current?.focus();
                  item.onSelect();
                }}
              >
                <span aria-hidden="true" className={styles.itemGlyph}>
                  {item.glyph}
                </span>
                {item.label}
              </button>
            ))}
          </div>
          <p id={noteId} className={styles.note}>
            Or just say “help”, “repeat”, “next” or “stop”.
          </p>
        </div>
      )}
    </div>
  );
}

export function CalculusHeader({
  progress,
  label,
  showStuck,
  stuckDisabled,
  onHint,
  onRepeat,
  onSkip,
}: CalculusHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span aria-hidden="true" className={styles.leaf} />
        <span className={styles.brandText}>Sprout</span>
      </div>
      <div role="img" aria-label={label} className={styles.progress}>
        {progress.map((state, index) => (
          <span key={index} aria-hidden="true" className={`${styles.segment} ${styles[state]}`} />
        ))}
      </div>
      <div className={styles.actions}>
        {showStuck && <StuckMenu stuckDisabled={stuckDisabled} onHint={onHint} onRepeat={onRepeat} onSkip={onSkip} />}
      </div>
    </header>
  );
}
