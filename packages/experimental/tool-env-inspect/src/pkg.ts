/**
 * Read-only package-manager inventory for the installer/environment-manager plan.
 *
 * Every probe is a fixed package-owned executable and argv; the model chooses which managers to
 * probe and a result limit, never a command or an argument. Package names and versions are text
 * produced by the manager and its registries, so they are sanitized data here and never parsed
 * as instructions. Nothing installs, updates, or removes anything.
 * @module @deepseek-ai/dsh-experimental-tool-env-inspect/pkg
 */

import { createHash } from 'node:crypto'
import type { InstalledPackage, PkgInventoryCoverage, PkgManagerId, PkgManagerStatus } from './types.ts'
import { sanitizeField } from './apps.ts'

/** One package as a parser found it, before sanitization and identity derivation. */
export interface ParsedPackage {
  name: string
  version?: string
  /** The manager's own key for the package. */
  sourceKey: string
}

/** One parser's outcome. `note` explains a partial read without failing the probe. */
export interface ParseOutcome {
  packages: ParsedPackage[]
  note?: string
}

/** One fixed probe: the manager, its executable name, its argv, and its output parser. */
export interface PkgProbe {
  id: PkgManagerId
  /** Executable resolved on PATH; never a path or a shell built-in. */
  executable: string
  /** Fixed arguments. No element is ever derived from model input. */
  argv: readonly string[]
  parse: (stdout: string) => ParseOutcome
}

/** Parse an npm `ls -g --depth=0 --json` tree. */
function parseNpm(stdout: string): ParseOutcome {
  const parsed: unknown = JSON.parse(stdout)
  if (parsed === null || typeof parsed !== 'object') throw new Error('npm output is not an object')
  const dependencies = (parsed as { dependencies?: unknown }).dependencies
  if (dependencies === null || typeof dependencies !== 'object') return { packages: [] }
  const packages: ParsedPackage[] = []
  for (const [name, meta] of Object.entries(dependencies as Record<string, unknown>)) {
    const version = meta !== null && typeof meta === 'object' ? (meta as { version?: unknown }).version : undefined
    packages.push({ name, ...typeof version === 'string' ? { version } : {}, sourceKey: name })
  }
  return { packages }
}

/** Parse a pip `list --format=json` array. */
function parsePip(stdout: string): ParseOutcome {
  const parsed: unknown = JSON.parse(stdout)
  if (!Array.isArray(parsed)) throw new Error('pip output is not an array')
  const packages: ParsedPackage[] = []
  for (const entry of parsed) {
    if (entry === null || typeof entry !== 'object') continue
    const name = (entry as { name?: unknown }).name
    if (typeof name !== 'string' || name.length === 0) continue
    const version = (entry as { version?: unknown }).version
    packages.push({ name, ...typeof version === 'string' ? { version } : {}, sourceKey: name })
  }
  return { packages }
}

/** One winget table row's fields, split on the two-or-more spaces that pad its columns. */
function wingetFields(line: string): string[] {
  return line.trim().split(/\s{2,}/u)
}

/**
 * Parse a `winget list` table. The table is human-facing: the header names the columns and the
 * dashed line under it separates the header from the rows. Rows are split on their column
 * padding, which keeps double-width characters in names from shifting later columns the way a
 * character-offset slice would. A table with no recognizable header is reported as partial.
 */
function parseWinget(stdout: string): ParseOutcome {
  const lines = stdout.split(/\r?\n/u)
  const headerIndex = lines.findIndex(line => /^Name\s{2,}Id\s{2,}Version/u.test(line.trim()))
  if (headerIndex === -1) return { packages: [], note: 'winget printed no recognizable package table' }
  const packages: ParsedPackage[] = []
  let skipped = 0
  for (const line of lines.slice(headerIndex + 1)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || /^-{3,}/u.test(trimmed)) continue
    const fields = wingetFields(line)
    const [name, sourceKey, version] = fields
    if (name === undefined || sourceKey === undefined || fields.length < 2) { skipped++; continue }
    packages.push({ name, ...version !== undefined && version.length > 0 ? { version } : {}, sourceKey })
  }
  return skipped > 0
    ? { packages, note: `${skipped} row(s) did not match the table's columns` }
    : { packages }
}

/**
 * The fixed probes. Each argv is package source: a deployment cannot change it and the model
 * cannot influence it. `choco` and `scoop` are deliberately absent — their output formats have
 * no host evidence here, and an unverified parser would report guesses as inventory.
 */
export const PKG_PROBES: readonly PkgProbe[] = [
  { id: 'winget', executable: 'winget', argv: ['list', '--disable-interactivity', '--accept-source-agreements'], parse: parseWinget },
  { id: 'npm', executable: 'npm', argv: ['ls', '-g', '--depth=0', '--json'], parse: parseNpm },
  { id: 'pip', executable: 'pip', argv: ['list', '--format=json'], parse: parsePip },
]

/** Every manager this package can probe, in probe order. */
export const PKG_MANAGER_IDS = PKG_PROBES.map(probe => probe.id)

/** What the inventory reads and what it can never see, independent of this call's outcome. */
export const PKG_INVENTORY_COVERAGE: PkgInventoryCoverage = {
  includes: [
    'packages recorded by winget (machine and per-user)',
    'globally installed npm packages',
    'packages visible to the resolved pip interpreter',
  ],
  excludes: [
    'software installed without a package manager',
    'managers this call did not select or that are not installed',
    'chocolatey and scoop, whose output formats have no verified parser here',
  ],
  notCovered: [],
}

/**
 * Stable package identity: a digest of the manager and the manager's own package key. Display
 * names are mutable, so they are deliberately not inputs.
 * @param manager - the manager that recorded the package.
 * @param sourceKey - the manager's key for the package.
 * @returns a 16-character lowercase hex id.
 */
export function packageId(manager: PkgManagerId, sourceKey: string): string {
  return createHash('sha256').update(`${manager}\u0000${sourceKey}`).digest('hex').slice(0, 16)
}

/**
 * Sanitize one parser's packages into model-facing entries. A package whose sanitized name is
 * empty is dropped; a long name or version is capped by the shared field sanitizer.
 * @param manager - the manager that produced the packages.
 * @param parsed - the parser's packages.
 * @returns the entries in parser order.
 */
export function buildPackages(manager: PkgManagerId, parsed: readonly ParsedPackage[]): InstalledPackage[] {
  const packages: InstalledPackage[] = []
  for (const entry of parsed) {
    const name = sanitizeField(entry.name)
    if (name.value.length === 0) continue
    const version = entry.version === undefined ? undefined : sanitizeField(entry.version)
    const sourceKey = sanitizeField(entry.sourceKey).value
    packages.push({
      id: packageId(manager, sourceKey),
      name: name.value,
      ...version !== undefined && version.value.length > 0 ? { version: version.value } : {},
      manager,
      sourceKey,
    })
  }
  return packages
}

/**
 * Name the managers that were not read. An unavailable, denied, or failed probe is never
 * reported as an absence of packages.
 * @param platform - the platform the probes ran on.
 * @param reports - the per-manager reports.
 * @returns the not-covered list for the result's coverage block.
 */
export function pkgNotCovered(
  platform: string,
  reports: readonly { id: PkgManagerId; status: PkgManagerStatus; note?: string }[],
): string[] {
  const notCovered = reports
    .filter(report => report.status !== 'ok')
    .map(report => `${report.id}${report.note !== undefined ? `: ${report.note}` : ''}`)
  if (platform !== 'win32' && reports.some(report => report.id === 'winget')) {
    notCovered.push(`winget is Windows-only (this host is ${platform})`)
  }
  return notCovered
}
