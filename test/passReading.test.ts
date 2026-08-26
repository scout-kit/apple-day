import { describe, expect, it } from 'vitest'
import { toPass } from '../src/domain/passes'

/*
  A pass names a location only once an organizer has checked that person in. Everybody
  reports to base first — that is where the jars and the apples are — so a page that names
  a location early invites a youth to go straight there instead.

  These read the document, which is where that rule is actually decided.
*/

describe('whether a pass names where somebody is going', () => {
  it('does once they are checked in', () => {
    expect(toPass({ revealShifts: true }).revealShifts).toBe(true)
  })

  it('does not before that', () => {
    expect(toPass({ revealShifts: false }).revealShifts).toBe(false)
  })

  it('does not when the field is missing', () => {
    // Absent means hidden. A pass predating the field must not be a way past the rule,
    // and this defaulted the other way until it was noticed.
    expect(toPass({}).revealShifts).toBe(false)
  })

  it('does not for anything that is not the literal true', () => {
    // Whatever a half-written document holds, it is not a check-in.
    for (const junk of ['true', 1, {}, [], null]) {
      expect(toPass({ revealShifts: junk }).revealShifts).toBe(false)
    }
  })
})

describe('the rest of a pass', () => {
  it('survives a document with nothing in it', () => {
    const pass = toPass({})
    expect(pass).toMatchObject({ eventId: '', personId: '', displayName: '', base: null })
    expect(pass.shifts).toEqual([])
    expect(pass.support).toEqual([])
  })


  it('still understands the single phone number passes used to carry', () => {
    expect(toPass({ supportPhone: '519-555-0100' }).support).toEqual([
      { name: '', phone: '519-555-0100', email: '' },
    ])
  })
})
