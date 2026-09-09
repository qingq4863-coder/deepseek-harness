/**
 * Payload types of the `env_inspect` result. One home for the probe shape; the tool registers no
 * session event and no projection, so nothing here merges into session-facing maps.
 */

/**
 * One probe result of an `env_inspect` call: the requested command name and every executable
 * match found on PATH, in PATH order. The first entry is the one a shell would execute.
 */
export interface EnvCommandProbe {
  /** The command name exactly as requested. */
  command: string
  /** Matching executable files in PATH order; empty when the command is not installed. */
  paths: string[]
}

/**
 * One version probe of an `env_version` call: the resolved executable and the version line it
 * printed, or why no version was obtained. Exactly one of `version` and `error` is present.
 */
export interface EnvVersionProbe {
  /** The command name exactly as requested. */
  command: string
  /** The executable that was resolved on PATH and approved for the `--version` run, when reached. */
  path?: string
  /** The child's captured stdout, trimmed; the tool reports `(no output)` for an empty run. */
  version?: string
  /** Why no version was obtained: unresolved, denied by the approval decision, nonzero exit, or deadline. */
  error?: string
}

/**
 * One read-only source of installed-application metadata. The id is stable and names the
 * registry hive/view or the AppX package list, so an entry's identity never depends on its
 * mutable display name.
 */
export type AppSourceId =
  | 'registry-machine'
  | 'registry-machine-x86'
  | 'registry-user'
  | 'app-paths-machine'
  | 'app-paths-machine-x86'
  | 'appx'

/**
 * What one source returned. `ok` means the source was read completely; `partial` means it was
 * read but the tool could not trust every row; `unavailable` means nothing was read and the
 * source must not be reported as an absence.
 */
export type AppSourceStatus = 'ok' | 'partial' | 'unavailable'

/** One source's outcome inside an `apps_inspect` result. */
export interface AppSourceReport {
  /** The source that was read. */
  id: AppSourceId
  status: AppSourceStatus
  /** Rows the source contributed before filtering; 0 when it was unavailable. */
  count: number
  /** Why the source was not fully read, when it was not. */
  note?: string
}

/** Which registry scope an entry belongs to; `user` entries are current-user writable. */
export type AppScope = 'machine' | 'user'

/** Whether an entry is an application or a registry artifact of one. */
export type AppKind = 'app' | 'component' | 'update' | 'child'

/** Entry architecture when the source states it, else `unknown`. */
export type AppArch = 'x86' | 'x64' | 'arm64' | 'unknown'

/** The installer family the entry's metadata indicates. */
export type AppInstaller = 'msi' | 'exe' | 'appx' | 'unknown'

/**
 * How much weight an entry deserves: machine-scope registry data is `high`, App Paths and AppX
 * are `medium`, and current-user registry data is `low` because any process running as this
 * user can write it. Instruction-like text in any field lowers the entry one step.
 */
export type AppConfidence = 'high' | 'medium' | 'low'

/**
 * One installed application or registry artifact. Every string field is sanitized third-party
 * data: control, bidirectional-override, and zero-width characters are removed, whitespace is
 * collapsed, and long values are truncated. `UninstallString` and `QuietUninstallString` are
 * never part of this type; only {@link InstalledApp.hasUninstaller} reports their presence.
 */
export interface InstalledApp {
  /** Stable identity derived from `sourceId` and `sourceKey`; never derived from the name. */
  id: string
  /** Display name (or App Paths launch name) after sanitization. */
  name: string
  version?: string
  publisher?: string
  installLocation?: string
  arch: AppArch
  scope: AppScope
  kind: AppKind
  installer: AppInstaller
  /** Whether an uninstall command exists; the command text itself is never returned. */
  hasUninstaller: boolean
  sourceId: AppSourceId
  /** The source's own key for this entry: registry subkey name or AppX package full name. */
  sourceKey: string
  confidence: AppConfidence
  /** Sanitized field names whose value was truncated at the field bound. */
  truncatedFields?: string[]
}

/** What the inventory covers and what it cannot see. */
export interface AppInventoryCoverage {
  /** Sources this tool reads when they are available. */
  includes: string[]
  /** Classes of software this inventory can never see. */
  excludes: string[]
  /** Sources that were not read this call, named with the reason. */
  notCovered: string[]
}

/** When and where one inventory snapshot was collected. */
export interface AppInventorySnapshot {
  /** Content id of the returned entry set, derived from the entry ids. */
  id: string
  /** Collection time as an ISO 8601 timestamp. */
  generatedAt: string
  /** Collection duration in milliseconds; 0 for a cache hit. */
  durationMs: number
  /** `process.platform` the collection ran on. */
  platform: string
  /** Whether this snapshot came from the in-process cache rather than a fresh collection. */
  fromCache: boolean
}

/** Result of one `apps_inspect` call. */
export interface AppsInspectResult {
  snapshot: AppInventorySnapshot
  sources: AppSourceReport[]
  apps: InstalledApp[]
  /** Matching entries before the `limit` was applied. */
  total: number
  /** Entries in `apps`; never greater than the requested `limit`. */
  returned: number
  /** Whether matching entries were left out by the `limit`. */
  truncated: boolean
  coverage: AppInventoryCoverage
}

/**
 * One named inventory snapshot kept by the composition: its content id, when it was collected,
 * and what its sources reported. The entries themselves stay in the plugin's bounded store.
 */
export interface AppSnapshotRef {
  name: string
  /** Content id of the stored entry set, derived from the entry ids. */
  id: string
  generatedAt: string
  /** Entries stored under this name. */
  total: number
  sources: AppSourceReport[]
}

/** One compared field that differs between two observations of the same entry. */
export interface AppFieldChange {
  field: 'name' | 'version' | 'publisher' | 'installLocation'
  before?: string
  after?: string
}

/** One entry present in both observations whose compared fields differ. */
export interface AppChangedEntry {
  id: string
  name: string
  sourceId: AppSourceId
  changes: AppFieldChange[]
}

/** Result of one `apps_diff` call. */
export interface AppsDiffResult {
  from: AppSnapshotRef
  to: AppSnapshotRef
  added: InstalledApp[]
  removed: InstalledApp[]
  changed: AppChangedEntry[]
  /** Entries per category before the `limit` was applied. */
  total: { added: number; removed: number; changed: number }
  /** Entries per category in the returned page. */
  returned: { added: number; removed: number; changed: number }
  /** Whether any category was cut by the `limit`. */
  truncated: boolean
  /**
   * Whether the two observations read different sets of sources. When true, an entry may appear
   * added or removed because a source was not read, not because the machine changed.
   */
  coverageChanged: boolean
  coverage: AppInventoryCoverage
}

/** One package manager this package can probe. */
export type PkgManagerId = 'winget' | 'npm' | 'pip'

/**
 * What one manager probe produced. `ok` means its output was read completely; `partial` means it
 * was read but something was incomplete; `unavailable` means the executable is not installed;
 * `denied` means the approval decision refused the run, so no process was spawned; `failed`
 * means the process ran but its output could not be used.
 */
export type PkgManagerStatus = 'ok' | 'partial' | 'unavailable' | 'denied' | 'failed'

/** One package manager's outcome inside a `pkg_inspect` result. */
export interface PkgManagerReport {
  id: PkgManagerId
  status: PkgManagerStatus
  /** Packages this manager contributed before filtering. */
  count: number
  /** The executable that was resolved and approved for the run, when one was resolved. */
  executable?: string
  /** Why the probe was not fully read, when it was not. */
  note?: string
}

/**
 * One package recorded by a package manager. The name and version are third-party text produced
 * by the manager and its registries, so they are sanitized data, never instructions.
 */
export interface InstalledPackage {
  /** Stable identity derived from the manager and the manager's own package key. */
  id: string
  name: string
  version?: string
  manager: PkgManagerId
  /** The manager's own key for the package: winget Id, or the npm/pip package name. */
  sourceKey: string
}

/** What the package-manager inventory covers and what it cannot see. */
export interface PkgInventoryCoverage {
  includes: string[]
  excludes: string[]
  notCovered: string[]
}

/** Result of one `pkg_inspect` call. */
export interface PkgInspectResult {
  snapshot: {
    generatedAt: string
    durationMs: number
    platform: string
  }
  managers: PkgManagerReport[]
  packages: InstalledPackage[]
  /** Matching packages before the `limit` was applied. */
  total: number
  /** Packages in `packages`; never greater than the requested `limit`. */
  returned: number
  truncated: boolean
  coverage: PkgInventoryCoverage
}
