/**
 * The shipped capability ceiling, asserted against the shipped configuration
 * rather than a copy of it.
 *
 * Two claims are proved. First, every preset `dsh-base` declares carries a
 * `capabilityRisk`, so the fail-closed contract is real in a shipped
 * composition instead of only in deployments that opt in. Second, with that
 * shipped configuration the guard admits a tool declared at or below the
 * ceiling and refuses a tool that declares nothing — and every tool package a
 * shipped profile mounts declares metadata on every registered tool, which is
 * what keeps the first claim from turning into a refused tool.
 */

import { readFileSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import PermissionPresetService from '../src/index.ts'

const signal = new AbortController().signal
const repoTestsDir = dirname(fileURLToPath(import.meta.url))

/** One preset row as the shipped bundle declares it. */
interface ShippedPreset {
  sandbox?: string
  approval?: string
  capabilityRisk?: string
}

/**
 * Read `dsh-base`'s permission row from the real bundle patch. The file uses
 * cordis `!!js` tags elsewhere, which a plain YAML reader rejects, so the tag
 * prefix is dropped: the permission row contains no tagged scalar.
 * @returns the shipped preset table, exactly as a profile composes it.
 */
function shippedPresets(): Record<string, ShippedPreset> {
  const raw = readFileSync(new URL('../../../bundle/base/cordis.patch.yml', import.meta.url), 'utf8')
  const document: unknown = yaml.load(raw.replace(/!!js\s+/g, ''))
  const row = findPermissionRow(document)
  if (row === undefined) throw new Error('dsh-base declares no permission row')
  return row
}

/** Depth-first search for the row whose `id` is `permission`. */
function findPermissionRow(value: unknown): Record<string, ShippedPreset> | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findPermissionRow(entry)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (record['id'] === 'permission') {
    const config = record['config'] as { presets?: Record<string, ShippedPreset> } | undefined
    return config?.presets
  }
  for (const nested of Object.values(record)) {
    const found = findPermissionRow(nested)
    if (found !== undefined) return found
  }
  return undefined
}

/** Every workspace package, keyed by its npm name. */
function workspacePackages(): Map<string, string> {
  const packagesRoot = resolve(repoTestsDir, '../../..')
  const found = new Map<string, string>()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = join(dir, entry.name)
      if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'tests' || entry.name === 'src') continue
      const manifest = join(full, 'package.json')
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }
        if (parsed.name !== undefined) found.set(parsed.name, full)
      } catch {
        // No readable manifest here, so this is a group directory: descend.
        walk(full)
      }
    }
  }
  walk(packagesRoot)
  return found
}

/** Row names `dsh-base` mounts, so a shipped session can reach them. */
function shippedRowNames(): string[] {
  const raw = readFileSync(new URL('../../../bundle/base/cordis.patch.yml', import.meta.url), 'utf8')
  const names = [...raw.matchAll(/^\s*-?\s*name:\s*'(@deepseek-ai\/[^'/]+)'/gm)].map(match => match[1] as string)
  return [...new Set(names)]
}

const declaredProbe = defineTool({
  name: 'declared-high-probe',
  description: 'probe declaring the shipped ceiling rank',
  parameters: {},
  capability: { dataClass: 'workspace', risk: 'high', reversible: true, approval: 'automatic' },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  async execute() { return 'ran' },
})

const unsignedProbe = defineTool({
  name: 'unsigned-probe',
  description: 'probe without capability metadata',
  parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  async execute() { return 'ran' },
})

describe('shipped capability ceiling', () => {
  it('declares a ceiling on every preset dsh-base ships', () => {
    const presets = shippedPresets()
    expect(Object.keys(presets).sort()).toEqual(['danger-full-access', 'read-only', 'workspace-write'])
    for (const [name, preset] of Object.entries(presets)) {
      expect(preset.capabilityRisk, `preset "${name}" must declare capabilityRisk`).toBe('high')
    }
  })

  it('fails closed for an undeclared tool and admits a declared one under the shipped config', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('shell', {
      sandboxMode: 'workspace-write',
      resolve() { throw new Error('shipped ceiling tests do not execute a shell') },
      run() { throw new Error('shipped ceiling tests do not execute a shell') },
      start() { throw new Error('shipped ceiling tests do not execute a shell') },
    })
    ctx.provide('approval', { config: { policy: 'ask' } })
    await ctx.plugin(PermissionPresetService, { presets: shippedPresets() as never, defaultPreset: 'workspace-write' })
    ctx.tools.register(declaredProbe)
    ctx.tools.register(unsignedProbe)

    const session = ctx.sessions.create(SessionId('shipped-ceiling'))
    ctx.permissionPresets.set(session, 'workspace-write')
    const agent = { session } as unknown as Agent
    const call = (name: string) => ctx.tools.execute({
      signal,
      callId: ToolCallId(name),
      name,
      arguments: {},
      agent,
    })

    const admitted = await call('declared-high-probe')
    expect(admitted.isError).toBe(false)
    const refused = await call('unsigned-probe')
    expect(refused.isError).toBe(true)
    expect(refused.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      .toBe('Error: tool "unsigned-probe" declares no capability metadata, which preset "workspace-write" requires')

    await ctx.fiber.dispose()
  })

  it('leaves no shipped tool provider without a declaration', () => {
    const packages = workspacePackages()
    const rows = shippedRowNames()
    // Corpus guards: a narrowed enumeration must fail loudly rather than pass
    // because it found nothing to check.
    expect(rows.length).toBeGreaterThan(40)
    expect(packages.size).toBeGreaterThan(150)

    const missing: string[] = []
    let providersChecked = 0
    for (const row of rows) {
      const dir = packages.get(row)
      if (dir === undefined) continue
      const sources = collectSources(join(dir, 'src'))
      let definitions = 0
      let declarations = 0
      for (const file of sources) {
        const text = readFileSync(file, 'utf8')
        definitions += [...text.matchAll(/defineTool\(\{/g)].length
        declarations += [...text.matchAll(/capability:\s*\{/g)].length
      }
      if (definitions === 0) continue
      providersChecked += 1
      if (declarations < definitions) missing.push(`${row} declares ${declarations} capability blocks for ${definitions} tools`)
    }
    expect(providersChecked).toBeGreaterThan(8)
    // `dsh-tools` is the registry: its two `defineTool` calls are the factory's
    // own fixtures, not shipped tools, so it is the one admitted non-provider.
    expect(missing.filter(entry => !entry.startsWith('@deepseek-ai/dsh-tools '))).toEqual([])
  })
})

/** Every TypeScript source under one package's `src`, or an empty list. */
function collectSources(dir: string): string[] {
  const found: string[] = []
  const walk = (current: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      // A package without `src/` has no sources to scan, which is not an error.
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) found.push(full)
    }
  }
  walk(dir)
  return found
}
