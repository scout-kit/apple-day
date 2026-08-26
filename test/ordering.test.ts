import { describe, expect, it } from 'vitest'
import { moveItem, nudgeItem, reorderByDrop } from '../src/domain/ordering'

/**
 * The list arithmetic behind dragging locations into order.
 *
 * Tested here rather than through the UI because jsdom does no layout: it cannot express
 * "the pointer was in the lower half of this row", which is exactly the input that decides
 * whether an item lands above or below its target.
 */

const LIST = ['a', 'b', 'c', 'd']

describe('moveItem', () => {
  it('moves an item earlier and later', () => {
    expect(moveItem(LIST, 2, 0)).toEqual(['c', 'a', 'b', 'd'])
    expect(moveItem(LIST, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('clamps past either end instead of losing the item', () => {
    expect(moveItem(LIST, 1, -5)).toEqual(['b', 'a', 'c', 'd'])
    expect(moveItem(LIST, 1, 99)).toEqual(['a', 'c', 'd', 'b'])
  })

  it('returns the same list when nothing moves', () => {
    expect(moveItem(LIST, 1, 1)).toBe(LIST)
    expect(moveItem(LIST, 9, 0)).toBe(LIST)
  })

  it('does not mutate the input', () => {
    const copy = [...LIST]
    moveItem(LIST, 0, 3)
    expect(LIST).toEqual(copy)
  })
})

describe('nudgeItem', () => {
  it('steps an item one place either way', () => {
    expect(nudgeItem(LIST, 'c', -1)).toEqual(['a', 'c', 'b', 'd'])
    expect(nudgeItem(LIST, 'b', 1)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('holds at the ends', () => {
    expect(nudgeItem(LIST, 'a', -1)).toBe(LIST)
    expect(nudgeItem(LIST, 'd', 1)).toBe(LIST)
  })

  it('ignores an unknown id', () => {
    expect(nudgeItem(LIST, 'zz', 1)).toBe(LIST)
  })
})

describe('reorderByDrop', () => {
  it('drops a later item above an earlier one', () => {
    expect(reorderByDrop(LIST, 'd', 'b', false)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('drops a later item below an earlier one', () => {
    expect(reorderByDrop(LIST, 'd', 'b', true)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('drops an earlier item below a later one', () => {
    // Moving down the list: removing the item first shifts the target up by one, and the
    // insertion index has to compensate. Without that, this lands above 'c' instead.
    expect(reorderByDrop(LIST, 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('drops an earlier item above a later one', () => {
    expect(reorderByDrop(LIST, 'a', 'c', false)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('handles the neighbouring cases without shuffling anything else', () => {
    expect(reorderByDrop(LIST, 'a', 'b', true)).toEqual(['b', 'a', 'c', 'd'])
    expect(reorderByDrop(LIST, 'b', 'a', false)).toEqual(['b', 'a', 'c', 'd'])
    // Dropping either side of where it already sits is a no-op.
    expect(reorderByDrop(LIST, 'b', 'a', true)).toEqual(LIST)
    expect(reorderByDrop(LIST, 'b', 'c', false)).toEqual(LIST)
  })

  it('moves to the very top and the very bottom', () => {
    expect(reorderByDrop(LIST, 'd', 'a', false)).toEqual(['d', 'a', 'b', 'c'])
    expect(reorderByDrop(LIST, 'a', 'd', true)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('does nothing when dropped on itself, or on something unknown', () => {
    expect(reorderByDrop(LIST, 'b', 'b', true)).toBe(LIST)
    expect(reorderByDrop(LIST, 'b', 'zz', true)).toBe(LIST)
    expect(reorderByDrop(LIST, 'zz', 'b', true)).toBe(LIST)
  })

  it('keeps every item exactly once, whatever the move', () => {
    for (const dragged of LIST) {
      for (const target of LIST) {
        for (const below of [true, false]) {
          const result = reorderByDrop(LIST, dragged, target, below)
          expect([...result].sort()).toEqual([...LIST].sort())
        }
      }
    }
  })
})
