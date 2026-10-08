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
  size = 'default',
  children,
}: {
  title: string
  onClose: () => void
  footer?: ReactNode
  /**
   * How much of the screen to take.
   *
   * `wide` is for a form with more than a couple of fields, which on a phone is most of
   * them. `full` is for something that has to be *looked at* rather than read — the camera
   * above all, where a viewfinder the size of a postage stamp is the difference between
   * reading a jar label and guessing at it.
   */
  size?: 'default' | 'wide' | 'full'
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
        className={`modal${size === 'default' ? '' : ` modal-${size}`}`}
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
