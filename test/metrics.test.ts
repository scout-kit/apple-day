import { describe, expect, it } from 'vitest'
import {
  locationMetrics,
  personTotals,
  sectionParticipation,
  staffedHoursByLocation,
  summariseMoney,
} from '../src/domain/metrics'
import { buildSlots } from '../src/domain/slots'
import {
  KNOWN,
  assignments2025,
  fridayAssignments2025,
  fridayJars2025,
  jars2025,
  locations2025,
  people2025,
  reconciliation2025,
  saturdayAssignments2025,
  saturdayJars2025,
  slots2025,
} from './fixtures/appleDay2025'

const find = <T extends { locationId: string }>(rows: T[], id: string): T | undefined =>
  rows.find((r) => r.locationId === id)

const round2 = (n: number): number => Math.round(n * 100) / 100

describe('2025 totals reproduce the workbook where the workbook was right', () => {
  it('matches the recorded jar totals to the cent', () => {
    const fri = locationMetrics(locations2025, fridayAssignments2025, fridayJars2025, slots2025)
    const sat = locationMetrics(locations2025, saturdayAssignments2025, saturdayJars2025, slots2025)
    const all = locationMetrics(locations2025, assignments2025, jars2025, slots2025)

    expect(fri.totalRevenue).toBe(KNOWN.fridayJarTotal)
    expect(sat.totalRevenue).toBe(KNOWN.saturdayJarTotal)
    expect(all.totalRevenue).toBe(KNOWN.grandJarTotal)
  })
})

describe('defect 1 — one location, one row', () => {
  it('collapses the six locations the year-end QUERY double-counted', () => {
    const report = locationMetrics(locations2025, assignments2025, jars2025, slots2025)
    // `ranked` and `revenueWithoutHours` partition every location that saw money or
    // hours. (`staffedWithoutRevenue` is a highlight list drawn from `ranked`, so it is
    // deliberately not part of the union.)
    const rows = [...report.ranked, ...report.revenueWithoutHours]

    for (const id of [
      'braemar-640', 'ferndale-hardware-400', 'copperpot-465',
      'pet-value-580', 'cactus-465', 'corner-chemist-aldergrove',
    ]) {
      expect(rows.filter((r) => r.locationId === id)).toHaveLength(1)
    }
  })

  it('sums Braemar across both days instead of splitting it in two', () => {
    const report = locationMetrics(locations2025, assignments2025, jars2025, slots2025)
    const braemar = find(report.ranked, 'braemar-640')

    // The workbook reported Braemar twice — $177.88/hr on Friday and $165.46/hr on
    // Saturday — because the two sheets spelled the name differently.
    expect(braemar?.revenue).toBe(
      Math.round((KNOWN.braemarFridayRevenue + KNOWN.braemarSaturdayRevenue) * 100) / 100,
    )
    expect(braemar?.revenue).toBe(1526.41)
  })
})

describe('defect 3 — hours count people, not filled cells', () => {
  it('counts two siblings in one cell as two person-hours', () => {
    const hours = staffedHoursByLocation(fridayAssignments2025, buildSlots('fri'))

    // `Friday Breakdown!F4` said 3, because COUNTA saw three non-empty cells and the
    // 6pm cell held two siblings.
    expect(hours.get('braemar-640')).toBe(4)
    // `Friday Breakdown!F12` said 3; the 8pm cell held two brothers.
    expect(hours.get('little-caesars-465')).toBe(4)
  })

  it('recovers the Saturday afternoon slots the Hours sheet never scanned', () => {
    const hours = staffedHoursByLocation(saturdayAssignments2025, buildSlots('sat'))
    const total = [...hours.values()].reduce((a, b) => a + b, 0)

    // The `Hours` sheet scanned Saturday columns I:M only — five of eight slots — and
    // totalled 25 person-hours for the day.
    expect(total).toBe(56)
    expect(hours.get('sjfm-1')).toBe(14)
    expect(hours.get('sjfm-2')).toBe(10)
  })

  it('changes the revenue-per-hour figure the location decision rests on', () => {
    const fri = locationMetrics(locations2025, fridayAssignments2025, fridayJars2025, slots2025)
    const braemar = find(fri.ranked, 'braemar-640')

    // Workbook: 533.65 / 3 = $177.88. Correct: 533.65 / 4 = $133.41.
    expect(braemar?.staffedHours).toBe(4)
    expect(braemar?.revenuePerHour).toBe(133.41)
    expect(braemar?.revenuePerHour).not.toBe(177.88)
  })
})

describe('defect 5 — revenue with no hours is an anomaly, not a ranking', () => {
  it('reports the Ravenhill Hardware jar as unrankable instead of 4th place', () => {
    const fri = locationMetrics(locations2025, fridayAssignments2025, fridayJars2025, slots2025)

    expect(find(fri.ranked, 'ravenhill-hardware-lounge')).toBeUndefined()

    const anomaly = find(fri.revenueWithoutHours, 'ravenhill-hardware-lounge')
    expect(anomaly).toBeDefined()
    expect(anomaly?.revenue).toBe(KNOWN.uncountedFridayJar)
    expect(anomaly?.staffedHours).toBe(0)
    // `Friday Breakdown!G17` reported $86.55/hour and ranked it 4 of 12.
    expect(anomaly?.revenuePerHour).toBeNull()
    expect(anomaly?.rank).toBeNull()
  })

  it('flags a location that was staffed and took nothing', () => {
    const fri = locationMetrics(locations2025, fridayAssignments2025, fridayJars2025, slots2025)
    const petValue = find(fri.staffedWithoutRevenue, 'pet-value-580')

    expect(petValue?.staffedHours).toBe(1)
    expect(petValue?.revenue).toBe(0)
  })

  it('ranks from the top with no gaps and no nulls', () => {
    const report = locationMetrics(locations2025, assignments2025, jars2025, slots2025)
    expect(report.ranked[0]?.rank).toBe(1)
    expect(report.ranked.every((r) => r.revenuePerHour !== null)).toBe(true)
    // The workbook's RANK gave every zero-revenue location a shared 12th place.
    expect(report.ranked.map((r) => r.rank)).toEqual(
      report.ranked.map((_, i) => i + 1),
    )
  })
})

describe('defect 8 — one set of totals, derived from the jars', () => {
  it('adds the jars up per day, split by how they were counted', () => {
    const summary = summariseMoney(jars2025, reconciliation2025)

    const friday = summary.days.find((d) => d.day === 'fri')!
    const saturday = summary.days.find((d) => d.day === 'sat')!
    expect(friday.jarTotal).toBe(KNOWN.fridayJarTotal)
    expect(saturday.jarTotal).toBe(KNOWN.saturdayJarTotal)
    // Cash and card come from the jars themselves, so they always reconstruct the total.
    expect(friday.cash + friday.card).toBeCloseTo(friday.jarTotal, 2)
  })

  it('counts money raised once, never adding card takings twice', () => {
    const summary = summariseMoney(jars2025, reconciliation2025)
    expect(summary.jarTotal).toBe(KNOWN.grandJarTotal)
    // Jars plus bushel sales. The workbook summed both days, a card total and bushel sales
    // into one $6,089.06 figure that counted the card takings a second time.
    expect(summary.grandTotal).toBe(6014.61)
    expect(summary.cash + summary.card).toBe(summary.jarTotal)
  })

  it('still catches the jar that caused the old $86.55 gap', () => {
    // The hand-typed totals that surfaced this are gone; the detection is not. A jar at a
    // location nobody was rostered to is revenue with no staffed hours.
    const fri = locationMetrics(
      locations2025,
      fridayAssignments2025,
      fridayJars2025,
      slots2025,
    )
    const anomaly = find(fri.revenueWithoutHours, 'ravenhill-hardware-lounge')
    expect(anomaly?.revenue).toBe(KNOWN.uncountedFridayJar)
    expect(anomaly?.revenuePerHour).toBeNull()
  })

  it('reports nothing outstanding for a finished event', () => {
    expect(summariseMoney(jars2025, reconciliation2025).stillOut).toBe(0)
  })

  it('compares against the bank only when a deposit is entered', () => {
    const withoutDeposit = summariseMoney(jars2025, reconciliation2025)
    expect(withoutDeposit.depositVariance).toBe(0)

    const short = summariseMoney(jars2025, { ...reconciliation2025, deposit: 6000 })
    expect(short.depositVariance).toBe(round2(6000 - short.grandTotal))
  })
})

describe('defect 4 — sections are values, not substrings', () => {
  it('keeps scouters out of the scouts count', () => {
    const people = people2025.map((p, i) => (i === 0 ? { ...p, section: 'scouters' as const } : p))
    const { rows } = sectionParticipation(people, assignments2025, slots2025)

    const scouts = rows.find((r) => r.section === 'scouts')!
    const scouters = rows.find((r) => r.section === 'scouters')!

    expect(scouters.people).toBe(1)
    // The `Hours` sheet counted the substring "Scout", so every Scouter landed in both.
    expect(scouts.people).toBeGreaterThan(0)
    expect(rows.reduce((s, r) => s + r.people, 0)).toBe(people.length)
  })

  it('shares sum to one across all sections', () => {
    const { rows, totalHours } = sectionParticipation(people2025, assignments2025, slots2025)
    expect(totalHours).toBe(84)
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 10)
  })
})

describe('no-shows and integrity', () => {
  it('excludes a no-show from staffed hours, so revenue per hour is not diluted', () => {
    const withNoShow = fridayAssignments2025.map((a) =>
      a.locationId === 'braemar-640' && a.slotId === 'fri-1700'
        ? { ...a, status: 'noShow' as const }
        : a,
    )
    const hours = staffedHoursByLocation(withNoShow, buildSlots('fri'))
    expect(hours.get('braemar-640')).toBe(3)
  })

  it('rolls revenue up per person now that a person is an id', () => {
    const jarsWithPeople = fridayJars2025.map((j, i) =>
      i < 3 ? { ...j, personId: 'y01' } : j,
    )
    const totals = personTotals(fridayAssignments2025, jarsWithPeople, slots2025)
    const y01 = totals.find((t) => t.personId === 'y01')!
    expect(y01.jarCount).toBe(3)
    expect(y01.revenue).toBe(127.5)
    expect(y01.hours).toBe(1)
  })
})
