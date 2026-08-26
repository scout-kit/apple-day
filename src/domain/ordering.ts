/**
 * Rearranging an ordered list of ids.
 *
 * Pure, and separate from the component, because the off-by-one is the whole difficulty:
 * dropping an item *below* a target means a different index depending on whether it came
 * from above or below that target, and jsdom cannot simulate the pointer geometry needed
 * to exercise that through the UI.
 */

/** Move the item at `from` to `to`, returning a new array. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return items
  const target = Math.max(0, Math.min(items.length - 1, to))
  if (from === target) return items

  const next = [...items]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return items
  next.splice(target, 0, moved)
  return next
}

/** Move `id` by `delta` places. */
export function nudgeItem<T>(items: T[], id: T, delta: number): T[] {
  const from = items.indexOf(id)
  return from === -1 ? items : moveItem(items, from, from + delta)
}

/**
 * Drop `dragged` immediately above or below `target`.
 *
 * When the item is moving down the list, removing it first shifts every later position up
 * by one — so the insertion index has to come back down to compensate. Getting that wrong
 * silently puts the row on the wrong side of where it was dropped.
 */
export function reorderByDrop<T>(
  items: T[],
  dragged: T,
  target: T,
  below: boolean,
): T[] {
  if (dragged === target) return items

  const from = items.indexOf(dragged)
  let to = items.indexOf(target)
  if (from === -1 || to === -1) return items

  if (below) to += 1
  if (from < to) to -= 1

  return moveItem(items, from, to)
}
