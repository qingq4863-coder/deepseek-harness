/**
 * Read-only installed-application inventory for the installer/environment-manager plan.
 *
 * The collection script below is fixed package source, never model input: the model chooses
 * filters and a result limit, and the script only reads registry uninstall entries, App Paths
 * mappings, and the current user's AppX packages. Everything it returns is third-party text —
 * installers write those registry values, and current-user entries need no elevation — so every
 * field is sanitized here, `UninstallString`/`QuietUninstallString` never leave this module, and
 * an entry whose text looks like an instruction is reported with lower confidence rather than
 * parsed.
 * @module @deepseek-ai/dsh-experimental-tool-env-inspect/apps
 */

import { createHash } from 'node:crypto'
import { win32 } from 'node:path'
import type { ShellExecutor, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type {
  AppArch,
  AppChangedEntry,
  AppConfidence,
  AppFieldChange,
  AppInventoryCoverage,
  AppInstaller,
  AppKind,
  AppScope,
  AppSourceId,
  AppSourceReport,
  InstalledApp,
} from './types.ts'

/**
 * Fixed read-only collection script. It uses registry-provider cmdlets only (no `.NET` static
 * calls, so it also runs under a ConstrainedLanguage PowerShell) and targets the 32-bit
 * `WOW6432Node` subtree explicitly instead of relying on a registry view, so a 32-bit host
 * process cannot silently duplicate or drop entries. Every source is contained: a missing key or
 * failing cmdlet is reported as an unavailable source rather than aborting the collection.
 */
export const APPS_INVENTORY_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$sourceReports = New-Object System.Collections.ArrayList
$rows = New-Object System.Collections.ArrayList

function Read-Values($path) {
  $values = [ordered]@{}
  $item = Get-ItemProperty -Path $path -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $values }
  foreach ($property in $item.PSObject.Properties) {
    if ($property.Name -like 'PS*') { continue }
    if ($null -eq $property.Value) { continue }
    $values[$property.Name] = [string]$property.Value
  }
  return $values
}

function Add-UninstallRows([string]$sourceId, [string]$scope, [string]$path) {
  if (-not (Test-Path $path)) {
    [void]$sourceReports.Add([ordered]@{ id = $sourceId; status = 'unavailable'; count = 0; note = 'registry key is not present' })
    return
  }
  $count = 0
  foreach ($subKey in @(Get-ChildItem -Path $path -ErrorAction SilentlyContinue)) {
    $values = Read-Values $subKey.PSPath
    [void]$rows.Add([ordered]@{ sourceId = $sourceId; sourceKey = $subKey.PSChildName; scope = $scope; values = $values })
    $count++
  }
  [void]$sourceReports.Add([ordered]@{ id = $sourceId; status = 'ok'; count = $count })
}

function Add-AppPathRows([string]$sourceId, [string]$path) {
  if (-not (Test-Path $path)) {
    [void]$sourceReports.Add([ordered]@{ id = $sourceId; status = 'unavailable'; count = 0; note = 'registry key is not present' })
    return
  }
  $count = 0
  foreach ($subKey in @(Get-ChildItem -Path $path -ErrorAction SilentlyContinue)) {
    $values = Read-Values $subKey.PSPath
    [void]$rows.Add([ordered]@{ sourceId = $sourceId; sourceKey = $subKey.PSChildName; scope = 'machine'; values = $values })
    $count++
  }
  [void]$sourceReports.Add([ordered]@{ id = $sourceId; status = 'ok'; count = $count })
}

function Add-AppxRows() {
  if ($null -eq (Get-Command Get-AppxPackage -ErrorAction SilentlyContinue)) {
    [void]$sourceReports.Add([ordered]@{ id = 'appx'; status = 'unavailable'; count = 0; note = 'Get-AppxPackage is not available' })
    return
  }
  $packages = @(Get-AppxPackage -ErrorAction SilentlyContinue)
  $count = 0
  foreach ($package in $packages) {
    $isFramework = '0'
    if ($package.IsFramework) { $isFramework = '1' }
    $values = [ordered]@{
      DisplayName = [string]$package.Name
      DisplayVersion = [string]$package.Version
      Publisher = [string]$package.Publisher
      InstallLocation = [string]$package.InstallLocation
      Architecture = [string]$package.Architecture
      SystemComponent = $isFramework
    }
    [void]$rows.Add([ordered]@{ sourceId = 'appx'; sourceKey = [string]$package.PackageFullName; scope = 'user'; values = $values })
    $count++
  }
  [void]$sourceReports.Add([ordered]@{ id = 'appx'; status = 'ok'; count = $count })
}

Add-UninstallRows 'registry-machine' 'machine' 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
Add-AppPathRows 'app-paths-machine' 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths'
Add-UninstallRows 'registry-machine-x86' 'machine' 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
Add-AppPathRows 'app-paths-machine-x86' 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths'
Add-UninstallRows 'registry-user' 'user' 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
Add-AppxRows

[ordered]@{ sources = @($sourceReports); rows = @($rows) } | ConvertTo-Json -Depth 8 -Compress
`

/** Every source this tool can read, in collection order. */
export const APP_SOURCE_IDS = [
  'registry-machine',
  'app-paths-machine',
  'registry-machine-x86',
  'app-paths-machine-x86',
  'registry-user',
  'appx',
] as const satisfies readonly AppSourceId[]

/** What the inventory reads and what it can never see, independent of this call's outcome. */
export const APP_INVENTORY_COVERAGE: AppInventoryCoverage = {
  includes: [
    'machine and per-user registry uninstall entries',
    'machine App Paths launch-name mappings',
    "the current user's AppX/MSIX packages",
  ],
  excludes: [
    'portable applications with no registry or AppX registration',
    'Start Menu shortcuts',
    'AppX packages registered only for other users',
    'package-manager inventories (winget, chocolatey, scoop, npm, pip)',
  ],
  notCovered: [],
}

/** One raw row exactly as the collection script emitted it. */
export interface RawInventoryRow {
  sourceId: AppSourceId
  sourceKey: string
  scope: AppScope
  /** Registry value names (App Paths default value is `(default)`) mapped to their text. */
  values: Record<string, string>
}

/** Parsed script output before classification and sanitization. */
export interface RawInventory {
  sources: AppSourceReport[]
  rows: RawInventoryRow[]
}

/** One sanitized field value plus what sanitization changed. */
export interface SanitizedField {
  value: string
  truncated: boolean
  suspicious: boolean
}

/** Longest retained value of one untrusted field, in characters. */
const FIELD_MAX_CHARS = 200

/** C0/C1 controls, bidirectional overrides, zero-width characters, and the Arabic letter mark. */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu

/**
 * Instruction-like patterns in third-party metadata. A match only lowers the entry's confidence;
 * the text is never interpreted, and no content is blocked.
 */
const INSTRUCTION_LIKE = [
  /\b(?:system|assistant|developer|user)\s*:/iu,
  /\bignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\b/iu,
  /\bdisregard\s+(?:all\s+)?(?:previous|prior|above|earlier)\b/iu,
  /\byou\s+are\s+now\b/iu,
  /\bnew\s+instructions?\b/iu,
  /\bdo\s+not\s+(?:ask|request)\s+(?:for\s+)?(?:approval|confirmation|permission)\b/iu,
  /忽略(?:以上|之前|上面|前面|所有)/u,
  /<\|[^|]{0,40}\|>/u,
  /\[inst\]/iu,
]

/**
 * Sanitize one untrusted metadata value: strip invisible and control characters, collapse
 * whitespace, trim, truncate at the field bound, and flag instruction-like text.
 * @param raw - the raw registry or AppX string.
 * @returns the model-safe value and what sanitization changed.
 */
export function sanitizeField(raw: string): SanitizedField {
  const cleaned = raw.replace(INVISIBLE, ' ').replace(/\s+/gu, ' ').trim()
  const suspicious = INSTRUCTION_LIKE.some(pattern => pattern.test(cleaned))
  if (cleaned.length <= FIELD_MAX_CHARS) return { value: cleaned, truncated: false, suspicious }
  return { value: cleaned.slice(0, FIELD_MAX_CHARS), truncated: true, suspicious }
}

/** Sanitize an optional field, treating a blank result as absent. */
function optionalField(raw: string | undefined): SanitizedField | undefined {
  if (raw === undefined) return undefined
  const field = sanitizeField(raw)
  return field.value.length === 0 ? undefined : field
}

/** Whether a raw value is present and not blank. */
function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0
}

/**
 * Classify one entry from its registry values. `SystemComponent`, `ReleaseType`, and
 * `ParentKeyName` mark patches, updates, and child components so the default `kind: 'app'`
 * filter can leave them out.
 * @param values - the entry's raw registry values.
 * @returns the entry kind.
 */
export function classifyKind(values: Record<string, string>): AppKind {
  if (values.SystemComponent === '1') return 'component'
  if (hasText(values.ReleaseType)) return 'update'
  if (hasText(values.ParentKeyName)) return 'child'
  return 'app'
}

/**
 * Classify the installer family from the uninstall command text and the source.
 * @param values - the entry's raw registry values.
 * @param sourceId - the source the entry came from.
 * @returns the installer family.
 */
export function classifyInstaller(values: Record<string, string>, sourceId: AppSourceId): AppInstaller {
  if (sourceId === 'appx') return 'appx'
  const uninstall = values.UninstallString ?? ''
  if (/msiexec/iu.test(uninstall)) return 'msi'
  return hasText(uninstall) ? 'exe' : 'unknown'
}

/**
 * Report architecture only where the source states it: AppX carries an architecture field, and
 * the 32-bit registry view means a 32-bit installer wrote the entry. A 64-bit-view entry says
 * nothing about the application's own architecture, so it stays `unknown` rather than guessed.
 * @param values - the entry's raw registry values.
 * @param sourceId - the source the entry came from.
 * @returns the entry architecture.
 */
export function classifyArch(values: Record<string, string>, sourceId: AppSourceId): AppArch {
  if (sourceId === 'appx') {
    switch ((values.Architecture ?? '').toLowerCase()) {
      case 'x86': return 'x86'
      case 'x64': return 'x64'
      case 'arm64': return 'arm64'
      default: return 'unknown'
    }
  }
  if (sourceId === 'registry-machine-x86' || sourceId === 'app-paths-machine-x86') return 'x86'
  return 'unknown'
}

/** Base confidence per source, before instruction-like text lowers it. */
const BASE_CONFIDENCE: Record<AppSourceId, AppConfidence> = {
  'registry-machine': 'high',
  'registry-machine-x86': 'high',
  'registry-user': 'low',
  'app-paths-machine': 'medium',
  'app-paths-machine-x86': 'medium',
  appx: 'medium',
}

/** Lower one confidence step; `low` is already the floor. */
function lowerConfidence(confidence: AppConfidence): AppConfidence {
  if (confidence === 'high') return 'medium'
  return 'low'
}

/**
 * Stable entry identity: a digest of the source id and the source's own key. Display names,
 * versions, and install locations are mutable, so they are deliberately not inputs.
 * @param sourceId - the source the entry came from.
 * @param sourceKey - the source's key for the entry.
 * @returns a 16-character lowercase hex id.
 */
export function appId(sourceId: AppSourceId, sourceKey: string): string {
  return createHash('sha256').update(`${sourceId}\u0000${sourceKey}`).digest('hex').slice(0, 16)
}

/**
 * Content id of one returned entry set, so a later snapshot comparison can tell whether two
 * observations saw the same entries without comparing every field.
 * @param apps - the returned entries.
 * @returns a 16-character lowercase hex id.
 */
export function snapshotId(apps: readonly InstalledApp[]): string {
  const ids = apps.map(app => app.id).sort()
  return createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 16)
}

/** Fields compared when the same stable id appears in both observations. */
const COMPARED_FIELDS = ['name', 'version', 'publisher', 'installLocation'] as const

/** One comparison's outcome: entries only in the later set, only in the earlier one, and changed. */
export interface AppDiff {
  added: InstalledApp[]
  removed: InstalledApp[]
  changed: AppChangedEntry[]
}

/**
 * Compare two observations by stable entry id. An id present only later is `added`, only earlier
 * is `removed`, and present in both with a different compared field is `changed`. Identity never
 * depends on a display name, so a renamed application still reads as one entry.
 * @param from - the earlier observation.
 * @param to - the later observation.
 * @returns the three categories, each ordered by name then id.
 */
export function diffApps(from: readonly InstalledApp[], to: readonly InstalledApp[]): AppDiff {
  const before = new Map(from.map(app => [app.id, app]))
  const after = new Map(to.map(app => [app.id, app]))
  const added = to.filter(app => !before.has(app.id))
  const removed = from.filter(app => !after.has(app.id))
  const changed: AppChangedEntry[] = []
  for (const [id, beforeApp] of before) {
    const afterApp = after.get(id)
    if (afterApp === undefined) continue
    const changes: AppFieldChange[] = []
    for (const field of COMPARED_FIELDS) {
      if (beforeApp[field] === afterApp[field]) continue
      changes.push({
        field,
        ...beforeApp[field] !== undefined ? { before: beforeApp[field] } : {},
        ...afterApp[field] !== undefined ? { after: afterApp[field] } : {},
      })
    }
    if (changes.length > 0) changed.push({ id, name: afterApp.name, sourceId: afterApp.sourceId, changes })
  }
  const byName = (left: InstalledApp, right: InstalledApp): number =>
    left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }) || left.id.localeCompare(right.id)
  added.sort(byName)
  removed.sort(byName)
  changed.sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }) || left.id.localeCompare(right.id))
  return { added, removed, changed }
}

/**
 * Whether two observations read the same set of sources with the same status. A difference means
 * an entry may appear added or removed because a source was not read.
 * @param from - the earlier observation's source reports.
 * @param to - the later observation's source reports.
 * @returns true when any source id or status differs.
 */
export function coverageDiffers(from: readonly AppSourceReport[], to: readonly AppSourceReport[]): boolean {
  const key = (reports: readonly AppSourceReport[]): string =>
    reports.map(report => `${report.id}:${report.status}`).sort().join('\n')
  return key(from) !== key(to)
}

/** Collect the sanitized names of fields that were truncated. */
function truncatedFields(fields: Record<string, SanitizedField | undefined>): string[] {
  return Object.entries(fields)
    .filter(([, field]) => field?.truncated === true)
    .map(([name]) => name)
    .sort()
}

/** Whether any sanitized field carried instruction-like text. */
function suspicious(fields: Record<string, SanitizedField | undefined>): boolean {
  return Object.values(fields).some(field => field?.suspicious === true)
}

/** Strip one layer of surrounding quotes from a registry path value. */
function unquote(value: string): string {
  return value.replace(/^"(.*)"$/u, '$1')
}

/**
 * Turn one raw row into an entry, or skip it. Registry rows without a display name are
 * uninstall artifacts with no user-visible identity, and App Paths rows carry their launch name
 * as the entry name.
 * @param row - one raw row from the collection script.
 * @returns the entry, or `undefined` when the row has no usable identity.
 */
function toApp(row: RawInventoryRow): InstalledApp | undefined {
  const isAppPath = row.sourceId === 'app-paths-machine' || row.sourceId === 'app-paths-machine-x86'
  const name = optionalField(isAppPath ? row.sourceKey : row.values.DisplayName)
  if (name === undefined) return undefined
  const version = optionalField(row.values.DisplayVersion)
  const publisher = optionalField(row.values.Publisher)
  const location = optionalField(row.values.InstallLocation)
    ?? optionalField(isAppPath ? win32.dirname(unquote(row.values['(default)'] ?? '')) : undefined)
  const fields = { name, version, publisher, installLocation: location }
  const uninstall = row.values.UninstallString ?? row.values.QuietUninstallString
  return {
    id: appId(row.sourceId, row.sourceKey),
    name: name.value,
    ...version !== undefined ? { version: version.value } : {},
    ...publisher !== undefined ? { publisher: publisher.value } : {},
    ...location !== undefined ? { installLocation: location.value } : {},
    arch: classifyArch(row.values, row.sourceId),
    scope: row.scope,
    kind: classifyKind(row.values),
    installer: classifyInstaller(row.values, row.sourceId),
    hasUninstaller: row.sourceId !== 'appx' && !isAppPath && hasText(uninstall),
    sourceId: row.sourceId,
    sourceKey: sanitizeField(row.sourceKey).value,
    confidence: suspicious(fields) ? lowerConfidence(BASE_CONFIDENCE[row.sourceId]) : BASE_CONFIDENCE[row.sourceId],
    ...truncatedFields(fields).length > 0 ? { truncatedFields: truncatedFields(fields) } : {},
  }
}

/**
 * Build the entry list from parsed rows, skipping rows without a usable name.
 * @param raw - parsed collection output.
 * @returns entries in script order.
 */
export function buildApps(raw: RawInventory): InstalledApp[] {
  const apps: InstalledApp[] = []
  for (const row of raw.rows) {
    const app = toApp(row)
    if (app !== undefined) apps.push(app)
  }
  return apps
}

/** Read a JSON array property that PowerShell may serialize as a single object. */
function asArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** Read one string field of an unknown JSON object. */
function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Parse the collection script's JSON output.
 * @param stdout - the script's captured stdout.
 * @returns the parsed sources and rows.
 * @throws Error when the output is not the expected JSON object; malformed rows are skipped.
 */
export function parseInventoryOutput(stdout: string): RawInventory {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    // The script's only stdout is one ConvertTo-Json object, so a parse failure means the
    // output was cut short (bound) or the shell printed something else; both are unusable.
    throw new Error('apps_inspect: the inventory script produced unreadable output')
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error('apps_inspect: the inventory script produced unreadable output')
  const record = parsed as Record<string, unknown>
  const sources: AppSourceReport[] = []
  for (const entry of asArray(record.sources)) {
    if (entry === null || typeof entry !== 'object') continue
    const source = entry as Record<string, unknown>
    const id = readString(source, 'id')
    const status = readString(source, 'status')
    if (id === undefined || !(APP_SOURCE_IDS as readonly string[]).includes(id)) continue
    if (status !== 'ok' && status !== 'partial' && status !== 'unavailable') continue
    const count = source.count
    const note = readString(source, 'note')
    sources.push({
      id: id as AppSourceId,
      status,
      count: typeof count === 'number' && Number.isFinite(count) ? count : 0,
      ...note !== undefined ? { note: sanitizeField(note).value } : {},
    })
  }
  const rows: RawInventoryRow[] = []
  for (const entry of asArray(record.rows)) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const sourceId = readString(row, 'sourceId')
    const sourceKey = readString(row, 'sourceKey')
    const scope = readString(row, 'scope')
    if (sourceId === undefined || !(APP_SOURCE_IDS as readonly string[]).includes(sourceId)) continue
    if (sourceKey === undefined || sourceKey.length === 0) continue
    if (scope !== 'machine' && scope !== 'user') continue
    const values: Record<string, string> = {}
    const rawValues = row.values
    if (rawValues !== null && typeof rawValues === 'object' && !Array.isArray(rawValues)) {
      for (const [key, value] of Object.entries(rawValues as Record<string, unknown>)) {
        if (typeof value === 'string') values[key] = value
      }
    }
    rows.push({ sourceId: sourceId as AppSourceId, sourceKey, scope, values })
  }
  return { sources, rows }
}

/**
 * Name the sources that were not read. An unavailable or partial source is never reported as an
 * absence of software, so it is always listed here.
 * @param platform - the platform the collection ran on.
 * @param shellMounted - whether a shell executor was available to run the script.
 * @param sources - the per-source reports.
 * @returns the not-covered list for the result's coverage block.
 */
export function notCoveredFor(platform: string, shellMounted: boolean, sources: readonly AppSourceReport[]): string[] {
  if (platform !== 'win32') return [`installed-application inventory is Windows-only (this host is ${platform})`]
  if (!shellMounted) return ['no shell executor is mounted, so no inventory source could be read']
  return sources
    .filter(source => source.status !== 'ok')
    .map(source => `${source.id}${source.note !== undefined ? `: ${source.note}` : ''}`)
}

/**
 * Fixed stdout bound for the collection script. A large machine's JSON has to fit, and a stream
 * past the bound is reported as unreadable rather than parsed partially.
 */
const APPS_OUTPUT_MAX_BYTES = 4 * 1024 * 1024

/** Longest stderr tail quoted back in a failure note; it is untrusted text. */
const STDERR_TAIL_CHARS = 200

/** Every source reported unavailable with the same reason. */
export function unavailableSources(note: string): AppSourceReport[] {
  return APP_SOURCE_IDS.map(id => ({ id, status: 'unavailable' as const, count: 0, note }))
}

/** Read a failure cause as text without assuming an Error. */
function causeText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One collection outcome, before a call's filters are applied. */
export interface InventoryCollection {
  sources: AppSourceReport[]
  apps: InstalledApp[]
  /** When the underlying collection ran, as an ISO 8601 timestamp. */
  generatedAt: string
  /** Collection duration in milliseconds; 0 for a cache hit. */
  durationMs: number
  fromCache: boolean
}

/** What one inventory reader needs to read a machine. */
export interface InventoryReaderOptions {
  /** The platform the reader runs on; only `win32` has inventory sources. */
  platform: string
  /** Resolves the optional shell executor that runs the fixed collection script, per call. */
  shell: () => ShellExecutor | undefined
  /** Deadline of one collection run in milliseconds. */
  timeoutMs: number
  /** Snapshot cache lifetime in milliseconds; 0 disables caching. */
  cacheTtlMs: number
}

/** One composition's inventory reader; owns its own snapshot cache. */
export interface InventoryReader {
  /**
   * Read the machine, or answer from the cache while it is fresh.
   * @param signal - caller cancellation, forwarded to the shell run.
   * @returns the collection outcome.
   */
  read(signal: AbortSignal): Promise<InventoryCollection>
}

/**
 * Build an inventory reader. Platform and shell are parameters rather than ambient reads so the
 * unsupported-platform, missing-shell, shell-failure, and unreadable-output paths are testable
 * on every host. The cache holds the last successful collection only; a failure never serves
 * stale data.
 * @param options - the platform, shell resolver, deadline, and cache lifetime.
 * @returns the reader.
 */
export function createInventoryReader(options: InventoryReaderOptions): InventoryReader {
  let cache: { at: number; sources: AppSourceReport[]; apps: InstalledApp[]; generatedAt: string } | undefined
  return {
    async read(signal: AbortSignal): Promise<InventoryCollection> {
      if (options.platform !== 'win32') {
        return { sources: unavailableSources(`not read: this host is ${options.platform}`), apps: [], generatedAt: new Date().toISOString(), durationMs: 0, fromCache: false }
      }
      const shell = options.shell()
      if (shell === undefined) {
        return { sources: unavailableSources('not read: no shell executor is mounted'), apps: [], generatedAt: new Date().toISOString(), durationMs: 0, fromCache: false }
      }
      if (cache !== undefined && options.cacheTtlMs > 0 && Date.now() - cache.at < options.cacheTtlMs) {
        return { sources: cache.sources, apps: cache.apps, generatedAt: cache.generatedAt, durationMs: 0, fromCache: true }
      }
      const generatedAt = new Date().toISOString()
      const started = Date.now()
      const elapsed = (): number => Date.now() - started
      let run: ShellRunResult
      try {
        run = await shell.run(shell.resolve({
          command: APPS_INVENTORY_SCRIPT,
          timeoutMs: options.timeoutMs,
          signal,
          stdoutMaxBytes: APPS_OUTPUT_MAX_BYTES,
        }))
      } catch (error) {
        return { sources: unavailableSources(`not read: ${sanitizeField(causeText(error)).value}`), apps: [], generatedAt, durationMs: elapsed(), fromCache: false }
      }
      const stderr = sanitizeField(run.stderr.text).value.slice(-STDERR_TAIL_CHARS)
      const failure = run.aborted ? 'not read: the call was cancelled'
        : run.timedOut ? `not read: the collection timed out after ${run.timeoutMs}ms`
          : run.exitCode !== 0 ? `not read: the shell exited with code ${run.exitCode ?? 'null'}${stderr.length > 0 ? `: ${stderr}` : ''}`
            : run.stdout.truncated ? 'not read: the collection output exceeded the result bound'
              : undefined
      if (failure !== undefined) {
        return { sources: unavailableSources(failure), apps: [], generatedAt, durationMs: elapsed(), fromCache: false }
      }
      try {
        const raw = parseInventoryOutput(run.stdout.text)
        const apps = buildApps(raw)
        cache = { at: Date.now(), sources: raw.sources, apps, generatedAt }
        return { sources: raw.sources, apps, generatedAt, durationMs: elapsed(), fromCache: false }
      } catch (error) {
        return { sources: unavailableSources(`not read: ${sanitizeField(causeText(error)).value}`), apps: [], generatedAt, durationMs: elapsed(), fromCache: false }
      }
    },
  }
}
