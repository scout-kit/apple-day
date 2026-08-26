import { describe, expect, it } from 'vitest'
import {
  cleanSupport,
  contactLabel,
  isReachable,
  readSupport,
} from '../src/domain/support'

/**
 * Who a volunteer can reach on the day.
 *
 * The event used to carry one phone number and no email at all. The interesting part of
 * having several is the fallback: every event in the database, and every pass already
 * printed, carries the old single string.
 */

describe('reading what is stored', () => {
  it('reads a list of contacts', () => {
    expect(
      readSupport([
        { name: 'Devin', phone: '519-555-0100', email: 'devin@example.org' },
        { name: 'Base ops', phone: '519-555-0199', email: '' },
      ]),
    ).toEqual([
      { name: 'Devin', phone: '519-555-0100', email: 'devin@example.org' },
      { name: 'Base ops', phone: '519-555-0199', email: '' },
    ])
  })

  it('falls back to the single phone number every event used to carry', () => {
    // No migration: last year's event and every pass already published keep working.
    expect(readSupport(undefined, '519-555-0100')).toEqual([
      { name: '', phone: '519-555-0100', email: '' },
    ])
  })

  it('prefers the list once there is one', () => {
    expect(
      readSupport([{ name: 'Devin', phone: '519-555-0111', email: '' }], '519-555-0100'),
    ).toEqual([{ name: 'Devin', phone: '519-555-0111', email: '' }])
  })

  it('is empty when there is nothing to fall back to', () => {
    expect(readSupport(undefined, '')).toEqual([])
    expect(readSupport(undefined, undefined)).toEqual([])
    expect(readSupport([], '519-555-0100')).toEqual([])
  })

  it('drops a row with a name but no way of reaching anybody', () => {
    // Somebody who started typing and stopped is not a contact.
    expect(readSupport([{ name: 'Devin', phone: '', email: '' }])).toEqual([])
  })

  it('trims, so a stray space does not become a phone number', () => {
    expect(readSupport([{ name: ' Devin ', phone: ' 519-555-0100 ', email: '  ' }])).toEqual([
      { name: 'Devin', phone: '519-555-0100', email: '' },
    ])
  })

  it('ignores anything that is not a contact at all', () => {
    expect(readSupport(['519-555-0100', 42, null])).toEqual([])
  })

  it('ignores a field that is not text', () => {
    expect(readSupport([{ name: 7, phone: '519-555-0100', email: null }])).toEqual([
      { name: '', phone: '519-555-0100', email: '' },
    ])
  })
})

describe('isReachable', () => {
  it('is true with a phone', () => {
    expect(isReachable({ name: '', phone: '519-555-0100', email: '' })).toBe(true)
  })

  it('is true with only an email — some organizers would rather be written to', () => {
    expect(isReachable({ name: '', phone: '', email: 'devin@example.org' })).toBe(true)
  })

  it('is false with neither, whatever the name says', () => {
    expect(isReachable({ name: 'Devin', phone: '  ', email: '' })).toBe(false)
  })
})

describe('cleanSupport', () => {
  it('drops the empty rows the editor leaves behind', () => {
    expect(
      cleanSupport([
        { name: 'Devin', phone: '519-555-0100', email: '' },
        { name: '', phone: '', email: '' },
      ]),
    ).toEqual([{ name: 'Devin', phone: '519-555-0100', email: '' }])
  })

  it('trims every field', () => {
    expect(cleanSupport([{ name: ' Devin ', phone: ' 100 ', email: ' d@e.org ' }])).toEqual([
      { name: 'Devin', phone: '100', email: 'd@e.org' },
    ])
  })
})

describe('contactLabel', () => {
  it('uses the name when there is one', () => {
    expect(contactLabel({ name: 'Devin', phone: '100', email: '' })).toBe('Devin')
  })

  it('falls back to the phone number, so a row is never nameless on screen', () => {
    expect(contactLabel({ name: '', phone: '519-555-0100', email: '' })).toBe('519-555-0100')
  })

  it('falls back to the email when that is all there is', () => {
    expect(contactLabel({ name: '', phone: '', email: 'devin@example.org' })).toBe(
      'devin@example.org',
    )
  })
})
