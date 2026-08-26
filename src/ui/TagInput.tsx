import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * A list of short values, entered one at a time.
 *
 * Replaces a comma-separated text field that fought back: it parsed on every keystroke and
 * re-rendered the parsed result, so the comma you typed to start the next value was
 * stripped before you could type anything after it — leaving no way to add a second entry.
 *
 * Here a comma or Enter commits what has been typed, so the key that felt like it should
 * work does. Committed values become chips, and the in-progress text is kept separately
 * from them so nothing is reformatted while it is being typed.
 */
export function TagInput({
  values,
  onChange,
  placeholder,
  label,
}: {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  /** Accessible name for the text box. */
  label: string
}): ReactNode {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  /** Add whatever has been typed, ignoring blanks and anything already in the list. */
  const commit = (raw: string): void => {
    const additions = raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
    if (additions.length === 0) {
      setDraft('')
      return
    }

    const next = [...values]
    for (const value of additions) {
      // Case-insensitive: "Rover" and "rover" are the same alias.
      if (!next.some((v) => v.toLowerCase() === value.toLowerCase())) next.push(value)
    }
    onChange(next)
    setDraft('')
  }

  const remove = (value: string): void => {
    onChange(values.filter((v) => v !== value))
    inputRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === ',' || event.key === 'Enter') {
      // Enter would otherwise submit the surrounding form or dialog.
      event.preventDefault()
      commit(draft)
    } else if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      // Backspace on an empty box takes the last chip back, which is what every other
      // tag field does.
      event.preventDefault()
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div className="tag-input">
      {values.map((value) => (
        <span className="chip" key={value}>
          {value}
          <button
            className="x"
            aria-label={`Remove ${value}`}
            onClick={() => remove(value)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        aria-label={label}
        value={draft}
        placeholder={values.length === 0 ? placeholder : 'add another…'}
        onChange={(e) => {
          // Pasting several at once should split rather than land as one long value.
          if (e.target.value.includes(',')) commit(e.target.value)
          else setDraft(e.target.value)
        }}
        onKeyDown={onKeyDown}
        // Leaving the field keeps what was typed rather than discarding it.
        onBlur={() => commit(draft)}
      />
    </div>
  )
}
