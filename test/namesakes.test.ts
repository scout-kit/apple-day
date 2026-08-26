import { describe, expect, it } from 'vitest'
import { freePersonId, personId } from '../src/domain/importer'

/**
 * Two people with the same name.
 *
 * A section with two Lucas in it is an ordinary Tuesday, and the id derived from a person is
 * their name and their section — so the second one written landed on the first, and a youth
 * disappeared off the board with nothing said about it.
 */

describe('an id for somebody being added', () => {
  it('is the plain derived one when nobody has it', () => {
    expect(freePersonId('Luca', 'Moretti', 'scouts', [])).toBe(
      personId('Luca', 'Moretti', 'scouts'),
    )
  })

  it('steps aside for a name already in that section', () => {
    const first = personId('Luca', '', 'scouts')
    expect(freePersonId('Luca', '', 'scouts', [first])).not.toBe(first)
  })

  it('keeps stepping, for a third of the same name', () => {
    const first = personId('Luca', '', 'scouts')
    const second = freePersonId('Luca', '', 'scouts', [first])
    const third = freePersonId('Luca', '', 'scouts', [first, second])

    expect(new Set([first, second, third]).size).toBe(3)
  })

  it('numbers them the way somebody writing name badges would', () => {
    const first = personId('Luca', '', 'scouts')
    expect(freePersonId('Luca', '', 'scouts', [first])).toBe(`${first}-2`)
  })

  it('does not step aside for the same name in another section', () => {
    // Sections are already part of the id, so these do not collide to begin with.
    const cub = personId('Luca', '', 'cubs')
    expect(freePersonId('Luca', '', 'scouts', [cub])).toBe(personId('Luca', '', 'scouts'))
  })

  it('leaves the plain derived id alone, which the import depends on', () => {
    /*
      Re-importing a signup form must land on the same people rather than a second copy of
      everybody, and two rows meeting on one id is how a family resubmitting the form is
      recognised. The import reports that; it does not quietly make a second person of it.
    */
    expect(personId('Luca', '', 'scouts')).toBe('p-luca-scouts')
    expect(personId('Luca', '', 'scouts')).toBe(personId('Luca', '', 'scouts'))
  })
})
