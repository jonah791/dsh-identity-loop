/**
 * loop.ts — 身份闭环的**纯逻辑层**（无 DSH 依赖，可离线单测）。
 *
 * 本件相对旧三件的三处**语义新增/修正**都在这里：
 * 1. **op 一等实体**：`opId` 贯穿「入口物 → 落库 → 取用 → 沉淀」，未收口的 op 是**读数**不是遗忘。
 * 2. **站点知识读失败拒绝写**：旧 `loadRegistry` 读失败静默回落空表，随后写回 ⇒ **用空表覆盖真表**；
 *    本层把「不存在」（可按空表创建）与「损坏」（拒绝写）分成两种事实。
 * 3. **疑似凭据形态的 facts 代码级拒绝**：旧 `id_site_remember` 把 `value` 明文落盘；本层在写路径上
 *    拒收疑似秘密形态（从「体检提示」搬到「写入闸门」）。
 */

import { randomBytes } from 'node:crypto'

export const TRACE_KEYS = [
  'atMs', 'iso', 'tool', 'action', 'opId', 'site', 'field', 'outcome', 'detail', 'caller',
] as const

export type OpEventKind = 'begin' | 'entry' | 'stow' | 'use' | 'settle' | 'abandon'

export interface OpEvent {
  atMs: number
  iso: string
  opId: string
  event: OpEventKind
  site: string
  purpose?: string
  detail?: string
}

/** 操作标识：`op-<yyyymmdd>-<6hex>`（形态固定，便于 grep 与目视分辨） */
export function newOpId(now: Date = new Date(), hex?: string): string {
  const h = hex ?? randomBytes(3).toString('hex')
  const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return `op-${d}-${h.slice(0, 6)}`
}

export function opEventLine(e: OpEvent): string {
  const out: Record<string, unknown> = {
    atMs: e.atMs,
    iso: e.iso,
    opId: e.opId,
    event: e.event,
    site: e.site,
  }
  if (e.purpose !== undefined && e.purpose !== '') out['purpose'] = e.purpose
  if (e.detail !== undefined && e.detail !== '') out['detail'] = e.detail
  return JSON.stringify(out)
}

export function parseOpLine(line: string): OpEvent | null {
  const t = line.trim()
  if (t === '') return null
  try {
    const v = JSON.parse(t) as Partial<OpEvent>
    if (typeof v.opId !== 'string' || typeof v.event !== 'string' || typeof v.site !== 'string') return null
    return {
      atMs: typeof v.atMs === 'number' ? v.atMs : 0,
      iso: typeof v.iso === 'string' ? v.iso : '',
      opId: v.opId,
      event: v.event as OpEventKind,
      site: v.site,
      ...(typeof v.purpose === 'string' ? { purpose: v.purpose } : {}),
      ...(typeof v.detail === 'string' ? { detail: v.detail } : {}),
    }
  } catch {
    return null
  }
}

export interface OpenOp {
  opId: string
  site: string
  purpose: string
  atMs: number
}

/** 未收口的 op：有 `begin` 而无 `settle`/`abandon`（悬空 op 是可见读数，不是遗忘） */
export function openOps(events: readonly OpEvent[], site?: string): OpenOp[] {
  const begun = new Map<string, OpenOp>()
  for (const e of events) {
    if (e.event === 'begin') {
      begun.set(e.opId, { opId: e.opId, site: e.site, purpose: e.purpose ?? '', atMs: e.atMs })
    } else if (e.event === 'settle' || e.event === 'abandon') {
      begun.delete(e.opId)
    }
  }
  const all = [...begun.values()].sort((a, b) => b.atMs - a.atMs)
  return site === undefined ? all : all.filter((o) => o.site === site)
}

/** 未归因取用的计数（`opId` 为 null 的 use 行——让缺失成为可见读数） */
export function unattributedUses(events: readonly OpEvent[]): number {
  return events.filter((e) => e.event === 'use' && e.opId === '').length
}

// ---------- 站点知识（sites.json） ----------

export interface SiteFact {
  value: string
  note: string
  at: string
  source: 'migrated' | 'settled'
  opId: string | null
  compartment: string
}

export interface SitesFile {
  version: 1
  sites: Record<string, Record<string, SiteFact>>
}

export function emptySites(): SitesFile {
  return { version: 1, sites: {} }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isSitesFile(v: unknown): v is SitesFile {
  return isRecord(v) && isRecord(v['sites'])
}

/**
 * 解析 `sites.json`。
 *
 * **读失败与不存在是两种事实**（修旧件 U3）：调用方据此决定「按空表创建」还是「拒绝写入」——
 * 旧实现把两者都吞成空表，随后写回即用空表覆盖真表。
 */
export type SitesParse =
  | { ok: true; file: SitesFile }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'corrupt'; detail: string }

export function parseSites(raw: string | null): SitesParse {
  if (raw === null) return { ok: false, reason: 'missing' }
  try {
    const v = JSON.parse(raw) as unknown
    if (!isSitesFile(v)) return { ok: false, reason: 'corrupt', detail: '顶层缺少 sites 对象' }
    return { ok: true, file: v }
  } catch (err) {
    return { ok: false, reason: 'corrupt', detail: (err as Error).message }
  }
}

/** 疑似凭据形态（从体检搬到**写入闸门**）：命中即拒绝写入 facts */
const SECRETISH = [
  /(?:^|[^A-Za-z0-9])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:password|passwd|secret|token)\s*[:=]\s*\S{8,}/i,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
]

/** 这条 facts 的 value 看起来像不像凭据（像 ⇒ 应改走 vault，不该记在站点知识里） */
export function looksLikeSecret(value: string): boolean {
  const v = value.trim()
  if (v.length === 0) return false
  return SECRETISH.some((rx) => rx.test(v))
}

export interface FactWriteResult {
  readonly file: SitesFile
  readonly rejected?: string
}

/** 写入一条站点知识（**字段级**：同 site 同 key 覆盖，其余保留） */
export function upsertFact(
  file: SitesFile,
  input: {
    site: string
    key: string
    value: string
    note?: string
    source: 'migrated' | 'settled'
    opId: string | null
    compartment: string
  },
  now: Date = new Date(),
): FactWriteResult {
  if (input.site.trim() === '' || input.key.trim() === '') {
    return { file, rejected: 'site 与 key 都不能为空' }
  }
  if (looksLikeSecret(input.value)) {
    return {
      file,
      rejected: `疑似凭据形态，拒绝写入站点知识（value 前 12 字符：${input.value.slice(0, 12)}…）——请改用 idop_stow 落 vault`,
    }
  }
  const next: SitesFile = { version: 1, sites: { ...file.sites } }
  const siteFacts = { ...(next.sites[input.site] ?? {}) }
  siteFacts[input.key] = {
    value: input.value,
    note: input.note ?? '',
    at: now.toISOString(),
    source: input.source,
    opId: input.opId,
    compartment: input.compartment,
  }
  next.sites[input.site] = siteFacts
  return { file: next }
}

/** 某站点的知识条目（键排序，便于目视与快照比对） */
export function factsOf(file: SitesFile, site: string): Array<{ key: string } & SiteFact> {
  const facts = file.sites[site] ?? {}
  return Object.entries(facts)
    .map(([key, fact]) => ({ key, ...fact }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** 全部站点名（排序） */
export function siteNames(file: SitesFile): string[] {
  return Object.keys(file.sites).sort()
}

// ---------- 审计行（永不含值） ----------

export interface AuditEvent {
  atMs: number
  tool: string
  action: string
  opId: string | null
  site?: string
  field?: string
  outcome: 'ok' | 'refused' | 'failed'
  detail?: string
  caller?: string
}

/** 审计行：键集受白名单约束（值不在其中，detail 是自由文本 ⇒ 调用方必须先脱敏） */
export function auditLine(e: AuditEvent): string {
  const out: Record<string, unknown> = {
    atMs: e.atMs,
    iso: new Date(e.atMs).toISOString(),
    tool: e.tool,
    action: e.action,
    opId: e.opId,
    outcome: e.outcome,
  }
  if (e.site !== undefined && e.site !== '') out['site'] = e.site
  if (e.field !== undefined && e.field !== '') out['field'] = e.field
  if (e.detail !== undefined && e.detail !== '') out['detail'] = e.detail
  if (e.caller !== undefined && e.caller !== '') out['caller'] = e.caller
  return JSON.stringify(out)
}

/** 审计行的键集是否全在白名单内（供验收 N7 做机器断言） */
export function auditKeysAllowed(line: string): boolean {
  try {
    const v = JSON.parse(line) as Record<string, unknown>
    const allowed = new Set<string>(TRACE_KEYS)
    return Object.keys(v).every((k) => allowed.has(k))
  } catch {
    return false
  }
}

/** 调用者标识（宿主 exec 形状不保证 ⇒ 尽力取，取不到写空串） */
export function callerOf(exec: unknown): string {
  const e = exec as { agent?: { id?: unknown }; sessionId?: unknown } | undefined
  const id = e?.agent?.id ?? e?.sessionId
  return typeof id === 'string' ? id : ''
}

/** 从 vault 的 `set` 输出里取写入后的字段名清单（`字段=[a,b]`） */
export function parseWrittenFields(stdout: string): string[] {
  const m = /字段=\[([^\]]*)\]/.exec(stdout)
  if (m?.[1] === undefined) return []
  return m[1].split(',').map((s) => s.trim()).filter(Boolean)
}
