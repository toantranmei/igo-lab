'use client';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A modal popup on the native <dialog> (focus trap, Esc to close and the backdrop come from the browser).
 * The body is rendered only while open, so its inputs and ids exist once.
 */
export default function Modal({ open, onClose, title, children, footer, wide, id }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; id?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      id={id}
      className={`cl-modal${wide ? ' wide' : ''}`}
      aria-labelledby={id ? `${id}-title` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // a click on the backdrop (the dialog element itself, outside the panel) closes it
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="cl-modal-panel">
          <header>
            <h3 id={id ? `${id}-title` : undefined}>{title}</h3>
            <button type="button" className="ghost cl-modal-x" aria-label="Đóng" onClick={onClose}>
              ×
            </button>
          </header>
          <div className="cl-modal-body">{children}</div>
          {footer ? <footer>{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
