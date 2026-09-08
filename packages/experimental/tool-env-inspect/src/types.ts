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
