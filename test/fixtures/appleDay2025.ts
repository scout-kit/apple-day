/**
 * The real 2025 Apple Day results, reconstructed from `Scouts Apple Day 2026.xlsx`.
 *
 * Every dollar figure and every staffing placement here is taken verbatim from the
 * workbook's `Friday Jars`, `Saturday Jars`, `Friday Schedule` and `Saturday Schedule`
 * sheets. Locations use canonical ids, which is the point: Friday wrote
 * "Braemar - 640 Linden Drive" and Saturday wrote "Braemar Aldergrove - 640 Linden
 * Drive", and both are `braemar-640` here.
 *
 * People are anonymised (`y01`, `y02`, …). The workbook holds minors' names and parent
 * contact details and none of that belongs in a git repository. What matters for these
 * tests is the *shape* — specifically that some schedule cells held two people, which is
 * exactly what the old `COUNTA` hour count could not see.
 *
 * Known-good totals from the workbook, used as assertions:
 *   Friday jars    $2,042.30   (`TOTAL Breakdown!L5`)
 *   Saturday jars  $3,792.31   (`TOTAL Breakdown!L6`)
 *   Grand total    $5,834.61   (`TOTAL Breakdown!L7`)
 *   Friday cash counted $1,955.75 (`TOTAL Breakdown!K11`) — short by one jar
 */

import { buildAllSlots } from '../../src/domain/slots'
import type {
  Assignment,
  Day,
  Jar,
  Person,
  ScheduledLocation,
  Section,
  Signup,
} from '../../src/domain/types'

export const slots2025 = buildAllSlots()

// --------------------------------------------------------------------- locations

interface LocSpec {
  id: string
  name: string
  priority: number
  aliases: string[]
}

const LOCATION_SPECS: LocSpec[] = [
  // The six locations the workbook's year-end QUERY split into two rows each, because
  // it grouped by display string. Their historical spellings are recorded as aliases.
  { id: 'braemar-640', name: 'Braemar — 640 Linden Drive', priority: 1,
    aliases: ['Braemar - 640 Linden Drive', 'Braemar Aldergrove - 640 Linden Drive'] },
  { id: 'ferndale-hardware-400', name: 'Ferndale Hardware — 400 Marchmont St N', priority: 8,
    aliases: ['Ferndale Hardware - 400 Marchmont St', 'Ferndale Hardware Marchmont Street - 400 Marchmont St N'] },
  { id: 'copperpot-465', name: 'Copperpot Coffee — 465 Phillip St', priority: 10,
    aliases: ['Copperpot Coffee - 465 Phillip Street', 'Copperpot Coffee - 465 Phillip St.'] },
  { id: 'pet-value-580', name: 'Pet Valu — 582 Marchmont St N', priority: 13,
    aliases: ['Pet Value  - 582 Marchmont Street North', 'Pet Value - 582 Marchmont Street North'] },
  { id: 'cactus-465', name: 'The Cactus — 465 Phillip St', priority: 17,
    aliases: ['The Cactus Mexican restaurant - 465 Phillip St', 'Cactus Restaurant - 465 Phillip St. (After 12 Sat)'] },
  { id: 'corner-chemist-aldergrove', name: 'Corner Chemist — 190 Aldergrove Dr W', priority: 11,
    aliases: ['Corner Chemist - 640 Linden Drive', 'Corner Chemist - 190 Aldergrove Dr W, Elmbridge, ON A1B 2C3'] },

  { id: 'jacks', name: "Jack's Family Restaurant — 200 Benjamin Road", priority: 2, aliases: [] },
  { id: 'kelmont', name: 'Kelmont — 335 Farmers Market Road', priority: 5, aliases: [] },
  { id: 'pricewise', name: "Pricewise — 24 Forwell Creek Rd", priority: 7, aliases: [] },
  { id: 'starbucks-640', name: 'Starbucks — 640 Linden Drive', priority: 9, aliases: [] },
  { id: 'little-caesars-465', name: "Little Caesars & Thirstys — 465 Phillip St", priority: 14, aliases: [] },
  { id: 'sjfm-1', name: "Ashfield Farmers Market — Loc. 1", priority: 3, aliases: [] },
  { id: 'sjfm-2', name: "Ashfield Farmers Market — Loc. 2", priority: 4, aliases: [] },
  { id: 'sunset-grill-580', name: 'Sunset Grill — 580 Marchmont St N', priority: 6, aliases: [] },
  { id: 'bradys-465', name: "Brady's Meats — 465 Phillip St", priority: 12, aliases: [] },
  // The staff lounge that took $86.55 with nobody rostered — the anomaly the old
  // revenue/hour formula turned into a 4th-place ranking.
  { id: 'ravenhill-hardware-lounge', name: 'Ravenhill Hardware staff lounge', priority: 20, aliases: [] },
]

const ALL_FRI = ['fri-1700', 'fri-1800', 'fri-1900', 'fri-2000']
const ALL_SAT = [
  'sat-0700', 'sat-0800', 'sat-0900', 'sat-1000',
  'sat-1100', 'sat-1200', 'sat-1300', 'sat-1400',
]

/** Open across the whole of both scheduling windows, so hours never mask a test. */
const OPEN_ALL_DAY = {
  fri: { openMin: 17 * 60, closeMin: 21 * 60 },
  sat: { openMin: 7 * 60, closeMin: 15 * 60 },
}

export const locations2025: ScheduledLocation[] = LOCATION_SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  address: '',
  mapsUrl: '',
  lat: null,
  lng: null,
  groupCode: '',
  active: true,
  priority: spec.priority,
  siteContact: null,
  insurance: '',
  comments: '',
  openHours: { fri: { ...OPEN_ALL_DAY.fri }, sat: { ...OPEN_ALL_DAY.sat } },
  aliases: spec.aliases,
}))

// -------------------------------------------------------------------------- jars

/** [locationId, ...amounts] exactly as recorded on the jar sheets. */
const FRIDAY_JARS: [string, ...number[]][] = [
  ['copperpot-465', 19.95, 68.90, 38.65],
  ['jacks', 53.90, 167.60, 21.45, 14.05],
  ['braemar-640', 134.20, 131.05, 129.95, 32.20, 106.25],
  ['pricewise', 54.85, 99.35],
  ['corner-chemist-aldergrove', 50.25, 48.25, 94.60],
  ['starbucks-640', 1.80],
  ['little-caesars-465', 94.40, 68.90, 1.05, 6.40],
  ['cactus-465', 88.55, 10.75],
  ['kelmont', 73.00, 224.15],
  ['ferndale-hardware-400', 121.30],
  ['ravenhill-hardware-lounge', 86.55],
]

const SATURDAY_JARS: [string, ...number[]][] = [
  ['sunset-grill-580', 39.85, 133.85, 0, 55.75],
  ['braemar-640', 78.20, 54.10, 229.40, 118.75, 95.45, 115.60, 301.26],
  ['jacks', 29.05, 96.15, 22.45, 27.00, 249.15, 67.45, 33.00],
  ['sjfm-2', 430.35],
  ['sjfm-1', 343.25, 86.40, 105.45, 127.75, 105.45, 114.35],
  ['kelmont', 112.40, 181.10, 88.35],
  ['copperpot-465', 76.70, 39.30],
  ['bradys-465', 92.75, 48.40],
  ['pricewise', 51.95, 41.90],
]

function buildJars(day: Day, specs: [string, ...number[]][]): Jar[] {
  const jars: Jar[] = []
  let n = 0
  for (const [locationId, ...amounts] of specs) {
    for (const amount of amounts) {
      n += 1
      jars.push({
        id: `${day}-jar-${n}`,
        jarNumber: n,
        day,
        locationId: locationId!,
        personId: null,
        assignmentId: null, assignmentIds: [],
        // The 2025 figures are a finished event: every jar came back and was counted.
        status: 'counted',
        issuedAt: 0,
        issuedBy: 'fixture',
        amount,
        method: 'cash',
        note: '',
        countedBy: 'fixture',
        countedAt: n,
      })
    }
  }
  return jars
}

export const fridayJars2025 = buildJars('fri', FRIDAY_JARS)
export const saturdayJars2025 = buildJars('sat', SATURDAY_JARS)
export const jars2025 = [...fridayJars2025, ...saturdayJars2025]

// ------------------------------------------------------------------- assignments

/**
 * [locationId, slotId, ...personIds]
 *
 * Where a schedule cell held two names — siblings, or a pair of Venturers written as
 * "Calvin and Norm" — that is two entries here. The old `COUNTA` hour count saw one.
 */
const FRIDAY_PLACEMENTS: [string, string, ...string[]][] = [
  ['braemar-640', 'fri-1700', 'y01'],
  ['braemar-640', 'fri-1800', 'y02', 'y03'],
  ['braemar-640', 'fri-1900', 'y04'],
  ['jacks', 'fri-1700', 'y05'],
  ['jacks', 'fri-1800', 'y06'],
  ['jacks', 'fri-2000', 'y07'],
  ['ferndale-hardware-400', 'fri-1900', 'y08'],
  ['kelmont', 'fri-1800', 'y09'],
  ['kelmont', 'fri-1900', 'y10'],
  ['kelmont', 'fri-2000', 'y10'],
  ['corner-chemist-aldergrove', 'fri-1700', 'y11'],
  ['corner-chemist-aldergrove', 'fri-1800', 'y12'],
  ['corner-chemist-aldergrove', 'fri-1900', 'y13'],
  ['starbucks-640', 'fri-1700', 'y14'],
  ['pricewise', 'fri-1700', 'y15'],
  ['pricewise', 'fri-1900', 'y16'],
  ['pricewise', 'fri-2000', 'y16'],
  ['copperpot-465', 'fri-1700', 'y17'],
  ['copperpot-465', 'fri-1800', 'y18'],
  ['copperpot-465', 'fri-2000', 'y19'],
  ['little-caesars-465', 'fri-1700', 'y20'],
  ['little-caesars-465', 'fri-1800', 'y21'],
  ['little-caesars-465', 'fri-2000', 'y22', 'y23'],
  ['cactus-465', 'fri-1700', 'y24'],
  ['cactus-465', 'fri-2000', 'y25'],
  ['pet-value-580', 'fri-1800', 'y26'],
]

const SATURDAY_PLACEMENTS: [string, string, ...string[]][] = [
  ['sjfm-1', 'sat-0700', 'y30', 'y31'],
  ['sjfm-1', 'sat-0800', 'y30', 'y31'],
  ['sjfm-1', 'sat-0900', 'y30', 'y31'],
  ['sjfm-1', 'sat-1000', 'y32', 'y33'],
  ['sjfm-1', 'sat-1100', 'y34'],
  ['sjfm-1', 'sat-1200', 'y34'],
  ['sjfm-1', 'sat-1300', 'y35', 'y36'],
  ['sjfm-1', 'sat-1400', 'y35', 'y36'],
  ['sjfm-2', 'sat-0700', 'y37', 'y38'],
  ['sjfm-2', 'sat-0800', 'y37', 'y38'],
  ['sjfm-2', 'sat-0900', 'y37', 'y38'],
  ['sjfm-2', 'sat-1000', 'y37', 'y38'],
  ['sjfm-2', 'sat-1100', 'y37', 'y38'],
  ['sunset-grill-580', 'sat-0700', 'y39'],
  ['sunset-grill-580', 'sat-0800', 'y16'],
  ['sunset-grill-580', 'sat-0900', 'y16'],
  ['sunset-grill-580', 'sat-1000', 'y16'],
  ['sunset-grill-580', 'sat-1100', 'y16'],
  ['jacks', 'sat-0900', 'y20', 'y24'],
  ['jacks', 'sat-1000', 'y04', 'y40'],
  ['jacks', 'sat-1100', 'y41'],
  ['jacks', 'sat-1200', 'y41'],
  ['jacks', 'sat-1300', 'y42'],
  ['jacks', 'sat-1400', 'y43'],
  ['kelmont', 'sat-1000', 'y44'],
  ['kelmont', 'sat-1100', 'y45'],
  ['kelmont', 'sat-1400', 'y46'],
  ['braemar-640', 'sat-0900', 'y47', 'y48'],
  ['braemar-640', 'sat-1000', 'y49'],
  ['braemar-640', 'sat-1100', 'y50'],
  ['braemar-640', 'sat-1200', 'y51'],
  ['braemar-640', 'sat-1300', 'y52', 'y53'],
  ['braemar-640', 'sat-1400', 'y52', 'y53'],
  ['pricewise', 'sat-1300', 'y12', 'y26'],
  ['pricewise', 'sat-1400', 'y12', 'y26'],
  ['copperpot-465', 'sat-1000', 'y54'],
  ['copperpot-465', 'sat-1400', 'y55'],
  ['bradys-465', 'sat-1400', 'y56'],
]

function buildAssignments(specs: [string, string, ...string[]][], prefix: string): Assignment[] {
  const out: Assignment[] = []
  let n = 0
  for (const [locationId, slotId, ...personIds] of specs) {
    for (const personId of personIds) {
      n += 1
      out.push({
        id: `${prefix}-${n}`,
        slotId: slotId!,
        locationId: locationId!,
        personId,
        status: 'confirmed',
        whereabouts: 'here',
        checkedInAt: null,
        checkedOutAt: null,
      })
    }
  }
  return out
}

export const fridayAssignments2025 = buildAssignments(FRIDAY_PLACEMENTS, 'fa')
export const saturdayAssignments2025 = buildAssignments(SATURDAY_PLACEMENTS, 'sa')
export const assignments2025 = [...fridayAssignments2025, ...saturdayAssignments2025]

// ------------------------------------------------------------------------ people

/** Anonymous people covering every id referenced above, with a plausible section mix. */
export const people2025: Person[] = (() => {
  const ids = [...new Set(assignments2025.map((a) => a.personId))].sort()
  const sections: Section[] = ['beavers', 'cubs', 'scouts', 'venturers']
  return ids.map((id, i) => ({
    id,
    firstName: `Youth${id.slice(1)}`,
    lastName: 'Anonymous',
    section: sections[i % sections.length]!,
    parentName: '',
    parentEmail: '',
    parentPhone: '',
    pairWithPersonId: null,
  }))
})()

export const signups2025: Signup[] = people2025.map((p, i) => ({
  id: `su-${p.id}`,
  personId: p.id,
  availability: { fri: [...ALL_FRI], sat: [...ALL_SAT] },
  attendingWithYouth: i % 2 === 0,
  notes: '',
  sourceRow: i + 2,
  importedAt: 0,
}))

/**
 * The figures the jars cannot supply.
 *
 * The workbook also kept hand-assembled cash and card totals per day — Friday's said
 * $1,955.75 against $2,042.30 of jars, an $86.55 gap nobody spotted. Those totals are gone
 * now that every jar is counted once in the app: the second set of numbers was the problem,
 * not the detection. The Ravenhill Hardware jar that caused the gap is still caught, as revenue
 * at a location with no staffed hours.
 */

export const KNOWN = {
  fridayJarTotal: 2042.30,
  saturdayJarTotal: 3792.31,
  grandJarTotal: 5834.61,
  uncountedFridayJar: 86.55,
  braemarFridayRevenue: 533.65,
  braemarSaturdayRevenue: 992.76,
} as const
