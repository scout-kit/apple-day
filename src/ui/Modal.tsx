import { useEffect } from 'react'
import type { ReactNode } from 'react'

/**
 * A dialog, for editing something without losing your place in the list behind it.
 *
 * Escape and a backdrop click both close it, because being unable to get out of a form is
 * worse than losing an edit in progress.
 */
export function Modal({
  title,
  onClose,
  footer,
  children,
}: {
  title: string
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Stop whatever is behind the dialog scrolling under it. The dialog's own body has
    // `overscroll-behavior: contain`, so reaching its end does not chain out either.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="tiny ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
