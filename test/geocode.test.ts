import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeEstimate,
  lookupAddress,
  lookupAll,
  lookupEstimateMs,
} from '../src/lib/geocode'
import type { Location } from '../src/domain/types'

/**
 * Looking up where a shop is.
 *
 * Two things are worth holding here, and neither is the arithmetic. The first is the usage
 * policy: OpenStreetMap's geocoder is free, run on donated hardware, and asks for at most
 * one request a second — so a run of nineteen has to take nineteen seconds, and a test that
 * lets it go faster is a test that lets the app abuse somebody's gift.
 *
 * The second is that one bad address costs one shop. A run that stops at the first failure
 * leaves the rest unplaced with nothing saying which.
 */

const shop = (id: string, address: string): Location => ({
  id,
  name: id,
  address,
  mapsUrl: '',
  groupCode: '',
  siteContact: null,
  insurance: '',
  comments: '',
  openHours: {},
  aliases: [],
  lat: null,
  lng: null,
})

const answer = (lat: string, lon: string): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => [{ lat, lon, display_name: 'Somewhere' }],
  }) as Response

const nothing = (): Response =>
  ({ ok: true, status: 200, json: async () => [] }) as Response

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Run a promise that contains timer waits, letting the fake clock through. */
async function withClock<T>(work: Promise<T>): Promise<T> {
  const settled = work.then((value) => ({ value }))
  await vi.runAllTimersAsync()
  return (await settled).value
}

describe('looking up one address', () => {
  it('asks for a single result and reads it', async () => {
    fetchMock.mockResolvedValue(answer('43.47', '-80.52'))
    const found = await lookupAddress('1 High Street, Elmbridge ON')

    expect(found).toEqual({ lat: 43.47, lng: -80.52, label: 'Somewhere' })
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toContain('nominatim.openstreetmap.org')
    expect(url).toContain('limit=1')
  })

  it('does not ask about a blank address', async () => {
    expect(await lookupAddress('   ')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is null when nothing was found, rather than a guess', async () => {
    fetchMock.mockResolvedValue(nothing())
    expect(await lookupAddress('nowhere at all')).toBeNull()
  })

  it('is null for an answer that is not a position', async () => {
    // A geocoder that cannot parse its own answer must not put a pin at zero.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ lat: 'x', lon: 'y' }],
    } as Response)
    expect(await lookupAddress('somewhere')).toBeNull()
  })

  it('throws on a refusal, so it is not read as "not found"', async () => {
    /*
      Being rate-limited and not existing are different facts. Reporting a 429 as "no such
      place" would send somebody off to correct an address that was already right.
    */
    fetchMock.mockResolvedValue({ ok: false, status: 429 } as Response)
    await expect(lookupAddress('somewhere')).rejects.toThrow(/429/)
  })
})

describe('a run over several', () => {
  it('waits between them, as the usage policy asks', async () => {
    fetchMock.mockResolvedValue(answer('43.47', '-80.52'))
    const saved: string[] = []

    const run = lookupAll(
      [shop('a', '1 High St'), shop('b', '2 High St'), shop('c', '3 High St')],
      async ({ location }) => {
        saved.push(location.id)
      },
    )

    // The first goes immediately; the rest are behind the pause.
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock, 'half a second is not a second').toHaveBeenCalledTimes(1)

    await vi.runAllTimersAsync()
    await run
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(saved).toEqual(['a', 'b', 'c'])
  })

  it('takes at least a second per shop after the first', async () => {
    fetchMock.mockResolvedValue(answer('43.47', '-80.52'))
    const run = lookupAll([shop('a', 'x'), shop('b', 'y')], async () => {})

    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.runAllTimersAsync()
    await run
  })

  it('reports each as it lands, so a stopped run keeps what it found', async () => {
    fetchMock.mockResolvedValue(answer('43.47', '-80.52'))
    const saved: string[] = []

    const run = lookupAll(
      [shop('a', 'x'), shop('b', 'y'), shop('c', 'z')],
      async ({ location }) => {
        saved.push(location.id)
      },
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(saved, 'saved before the second lookup even starts').toEqual(['a'])

    await vi.runAllTimersAsync()
    await run
  })

  it('lets one bad address cost one shop and no more', async () => {
    fetchMock
      .mockResolvedValueOnce(answer('43.47', '-80.52'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(answer('43.49', '-80.50'))

    const outcomes = await withClock(
      lookupAll([shop('a', 'x'), shop('b', 'y'), shop('c', 'z')], async () => {}),
    )

    expect(outcomes).toHaveLength(3)
    expect(outcomes[0]!.found).not.toBeNull()
    expect(outcomes[1]!.found).toBeNull()
    expect(outcomes[1]!.error).toContain('network down')
    expect(outcomes[2]!.found, 'the run carried on past the failure').not.toBeNull()
  })

  it('never rejects, whatever happens', async () => {
    fetchMock.mockRejectedValue(new Error('everything is on fire'))
    const outcomes = await withClock(lookupAll([shop('a', 'x')], async () => {}))
    expect(outcomes[0]!.error).toBeTruthy()
  })

  it('says so when it found a place but could not save it', async () => {
    /*
      Found and not saved is a different problem from not found, and needs a different thing
      doing about it. Counting it as a failure to find would send somebody to check an
      address that was correct.
    */
    fetchMock.mockResolvedValue(answer('43.47', '-80.52'))
    const outcomes = await withClock(
      lookupAll([shop('a', 'x')], async () => {
        throw new Error('offline')
      }),
    )
    expect(outcomes[0]!.found).not.toBeNull()
    expect(outcomes[0]!.error).toMatch(/Found, but not saved.*offline/)
  })

  it('stops when asked, without finishing the list', async () => {
    fetchMock.mockResolvedValue(answer('43.47', '-80.52'))
    let stop = false

    const run = lookupAll(
      [shop('a', 'x'), shop('b', 'y'), shop('c', 'z')],
      async () => {
        stop = true
      },
      undefined,
      () => stop,
    )

    const outcomes = await withClock(run)
    expect(outcomes).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports progress as it goes', async () => {
    fetchMock.mockResolvedValue(answer('43.47', '-80.52'))
    const seen: string[] = []
    await withClock(
      lookupAll(
        [shop('a', 'x'), shop('b', 'y')],
        async () => {},
        (done, total) => seen.push(`${done}/${total}`),
      ),
    )
    expect(seen).toEqual(['1/2', '2/2'])
  })

  it('does nothing at all for an empty list', async () => {
    expect(await lookupAll([], async () => {})).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('saying how long it will take, before it is pressed', () => {
  it('costs nothing for one', () => {
    // The pause is between lookups, so a single one has none.
    expect(lookupEstimateMs(1)).toBe(0)
    expect(describeEstimate(1)).toBe('a moment')
  })

  it('grows with the list', () => {
    expect(lookupEstimateMs(19)).toBeGreaterThan(lookupEstimateMs(5))
  })

  it('reads in seconds for a normal year', () => {
    expect(describeEstimate(19)).toMatch(/about \d+ seconds/)
  })

  it('reads in minutes for a long one', () => {
    expect(describeEstimate(200)).toMatch(/about \d+ minutes/)
  })

  it('is never negative', () => {
    expect(lookupEstimateMs(0)).toBe(0)
  })
})
