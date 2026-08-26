import { describe, expect, it } from 'vitest'
import { PAGE, moreLabel, nextShown, paged } from '../src/domain/paging'

const rows = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

describe('showing a long list a page at a time', () => {
  it('shows the first page and counts what is behind it', () => {
    const p = paged(rows(400), PAGE)
    expect(p.rows).toHaveLength(PAGE)
    expect(p.total).toBe(400)
    expect(p.hidden).toBe(400 - PAGE)
  })

  it('never offers to show a negative number more', () => {
    /*
      The case that reaches here in practice: 400 rows, four pages opened, then a search
      narrows the list to three. `shown` is still 100 and the slice is fine — it is `hidden`
      that goes to −97 and puts "Show −97 more" on the screen.
    */
    const p = paged(rows(3), 100)
    expect(p.rows).toHaveLength(3)
    expect(p.hidden).toBe(0)
    expect(moreLabel(p.hidden)).toBe('')
  })

  it('stops growing at the end of the list', () => {
    expect(nextShown(PAGE, 30)).toBe(30)
    expect(nextShown(30, 30)).toBe(30)
  })

  it('says how many are left, and says so plainly on the last page', () => {
    expect(moreLabel(200)).toBe(`Show ${PAGE} more of 200`)
    expect(moreLabel(4)).toBe('Show the last 4')
    expect(moreLabel(0)).toBe('')
  })
})
