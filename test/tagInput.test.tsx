// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { TagInput } from '../src/ui/TagInput'

/**
 * Entering a list of short values.
 *
 * The field this replaces parsed its text on every keystroke and re-rendered the parsed
 * result, so the comma typed to start a second value was stripped immediately — making it
 * impossible to add more than one. Comma is therefore the key under test.
 */

function Harness({ initial = [] as string[] }): React.ReactNode {
  const [values, setValues] = useState(initial)
  return (
    <>
      <TagInput label="Aliases" values={values} onChange={setValues} placeholder="rover" />
      <output data-testid="value">{values.join('|')}</output>
    </>
  )
}

const box = (): HTMLElement => screen.getByLabelText('Aliases')
const current = (): string => screen.getByTestId('value').textContent ?? ''

describe('adding values', () => {
  it('commits on a comma, which is what was broken', async () => {
    render(<Harness />)
    await userEvent.type(box(), 'rover,')

    expect(current()).toBe('rover')
    // And the box is empty and ready for the next one.
    expect((box() as HTMLInputElement).value).toBe('')
  })

  it('lets a second value be typed straight after the comma', async () => {
    render(<Harness />)
    await userEvent.type(box(), 'rover,rovers,')
    expect(current()).toBe('rover|rovers')
  })

  it('commits on enter', async () => {
    render(<Harness />)
    await userEvent.type(box(), 'rover{Enter}')
    expect(current()).toBe('rover')
  })

  it('commits what is typed when the field loses focus', async () => {
    // Otherwise a value typed and not confirmed disappears on save.
    render(<Harness />)
    await userEvent.type(box(), 'rover')
    await userEvent.tab()
    expect(current()).toBe('rover')
  })

  it('trims surrounding space', async () => {
    render(<Harness />)
    await userEvent.type(box(), '  rover  ,')
    expect(current()).toBe('rover')
  })

  it('ignores an empty entry', async () => {
    render(<Harness />)
    await userEvent.type(box(), ',,{Enter}')
    expect(current()).toBe('')
  })

  it('ignores a duplicate, whatever its case', async () => {
    render(<Harness initial={['Rover']} />)
    await userEvent.type(box(), 'rover,')
    expect(current()).toBe('Rover')
  })

  it('splits a pasted list rather than taking it as one value', async () => {
    render(<Harness />)
    await userEvent.click(box())
    await userEvent.paste('rover, rovers, roving')
    expect(current()).toBe('rover|rovers|roving')
  })
})

describe('removing values', () => {
  it('removes one by its own button', async () => {
    render(<Harness initial={['rover', 'rovers']} />)
    await userEvent.click(screen.getByLabelText('Remove rover'))
    expect(current()).toBe('rovers')
  })

  it('takes the last one back on backspace in an empty box', async () => {
    render(<Harness initial={['rover', 'rovers']} />)
    await userEvent.click(box())
    await userEvent.keyboard('{Backspace}')
    expect(current()).toBe('rover')
  })

  it('does not eat a chip while there is text to delete', async () => {
    render(<Harness initial={['rover']} />)
    await userEvent.type(box(), 'abc')
    await userEvent.keyboard('{Backspace}')

    expect(current()).toBe('rover')
    expect((box() as HTMLInputElement).value).toBe('ab')
  })
})

describe('what it shows', () => {
  it('shows each committed value as a chip', () => {
    render(<Harness initial={['rover', 'rovers']} />)
    expect(screen.getByLabelText('Remove rover')).toBeDefined()
    expect(screen.getByLabelText('Remove rovers')).toBeDefined()
  })

  it('prompts differently once something is in the list', async () => {
    render(<Harness />)
    expect((box() as HTMLInputElement).placeholder).toBe('rover')
    await userEvent.type(box(), 'x,')
    expect((box() as HTMLInputElement).placeholder).toBe('add another…')
  })
})
