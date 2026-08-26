import Papa from 'papaparse'

/** CSV in and out. Everything happens in the browser — Spark has no Cloud Storage. */

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
  errors: string[]
}

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })

  return {
    headers: result.meta.fields ?? [],
    rows: result.data.filter((r) => r && typeof r === 'object'),
    // Papa reports a row index; make it a 1-based line number for a human.
    errors: result.errors.map((e) =>
      e.row === undefined ? e.message : `Line ${e.row + 2}: ${e.message}`,
    ),
  }
}

export function toCsv(rows: Record<string, string>[]): string {
  return Papa.unparse(rows, { quotes: true })
}

/**
 * Hand the browser a file to save.
 *
 * Note for anyone deploying this as an Artifact rather than to Hosting: viewer sandboxes
 * block script-driven downloads. On Firebase Hosting this works normally.
 */
export function downloadFile(filename: string, contents: string, mime = 'text/csv'): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file'))
    reader.readAsText(file)
  })
}
