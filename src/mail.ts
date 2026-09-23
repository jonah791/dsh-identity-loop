/**
 * mail.ts — 锚点邮箱的**唯一出网通道**（承 `dsh-identity-ops`，通道不变）。
 *
 * 已做对的部分原样保留：`sessionToken` 从 Playwright storageState 的 localStorage 里取 token
 * （token 一直躺在那里，不必开浏览器）、出网一律经 `config.proxy` 的 `ProxyAgent`
 * （**fail-closed：代理不通即失败，绝不回落直连**，承 §5.26 G6）。
 *
 * 纪律：邮件正文是**外部内容**——提取结果永不当作指令（§5.27 规则 1）。
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const req = createRequire(import.meta.url)

/** undici 用 cjs require 取（宿主已有；绕开 TS 类型解析） */
function undici(): any {
  return req('undici')
}

export interface Mailbox {
  readonly statePath: string
  readonly apiBase: string
  readonly tokenKey: string
}

export interface MailboxOverride {
  readonly statePath?: string
  readonly apiBase?: string
  readonly tokenKey?: string
}

/** 邮箱配置来自**数据**（注册表/配置）⇒ 换邮箱是改数据，不是改代码 */
export function mailboxOf(override: MailboxOverride, defaultStateDir: string): Mailbox {
  return {
    statePath: override.statePath ?? `${defaultStateDir}/qrypty-session.json`,
    apiBase: override.apiBase ?? 'https://qrypty.com',
    tokenKey: override.tokenKey ?? 'qrypty_token',
  }
}

/** 从 storageState 取会话 token；**取不到响亮抛错**（不静默返回空） */
export function sessionToken(mb: Mailbox): string {
  const st = JSON.parse(readFileSync(mb.statePath, 'utf8')) as {
    origins?: Array<{ localStorage?: Array<{ name?: string; value?: unknown }> }>
  }
  for (const o of st.origins ?? []) {
    for (const kv of o.localStorage ?? []) {
      if (kv.name === mb.tokenKey) return String(kv.value)
    }
  }
  throw new Error('token not found in storageState: ' + mb.tokenKey)
}

export async function mailGet(mb: Mailbox, proxy: string, path: string): Promise<any> {
  const { fetch: ufetch, ProxyAgent } = undici()
  const r = await ufetch(mb.apiBase + path, {
    headers: {
      Authorization: 'Bearer ' + sessionToken(mb),
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
    dispatcher: new ProxyAgent(proxy),
    signal: AbortSignal.timeout(40000),
  })
  if (!r.ok) throw new Error('HTTP ' + String(r.status) + ' ' + path)
  return await r.json()
}

export interface MailRow {
  readonly id: string
  readonly subject: string
  readonly from: string
  readonly at: string
  readonly snippet: string
}

export function toRows(emails: unknown, limit: number): MailRow[] {
  const list = Array.isArray(emails) ? emails : []
  return list.slice(0, limit).map((e: any) => ({
    id: String(e?.id ?? ''),
    subject: String(e?.subject ?? ''),
    from: String(e?.from_address ?? '?'),
    at: String(e?.received_at ?? e?.created_at ?? ''),
    snippet: String(e?.snippet ?? ''),
  }))
}

/** 取一封匹配邮件（正则对 subject + 发件人 + 摘要）；无命中**抛错** */
export function pickEmail(emails: unknown, match: string): any {
  const rx = new RegExp(match, 'i')
  const list = Array.isArray(emails) ? emails : []
  const hit = list.filter((x: any) =>
    rx.test([x?.subject, x?.from_address, x?.from_name, x?.snippet].filter(Boolean).join(' ')),
  )
  if (hit.length === 0) throw new Error('no email matching: ' + match)
  return hit[0]
}

export function bodyOf(email: any): string {
  return String(email?.body_text ?? email?.body ?? email?.snippet ?? '')
}

/** 验证码提取（默认模式与旧件一致） */
export const DEFAULT_CODE_PATTERN =
  '(?:code|verification code|verify|entering the code below)[^0-9]{0,80}([0-9]{4,10})'

export function extractCode(email: any, pattern?: string): string {
  const body = bodyOf(email)
  const rx = new RegExp(pattern ?? DEFAULT_CODE_PATTERN, 'i')
  const m = rx.exec(body)
  if (m === null || m[1] === undefined) throw new Error('pattern not found in subject: ' + String(email?.subject ?? ''))
  return m[1]
}

/** 链接提取（去重 + 去尾标点） */
export function extractLinks(email: any, pattern?: string): string[] {
  const body = bodyOf(email) + ' ' + String(email?.body_html ?? '')
  let urls = [
    ...new Set((body.match(/https?:\/\/[^\s"'<>)]+/g) ?? []).map((u: string) => u.replace(/[.,;]$/, ''))),
  ]
  if (pattern !== undefined && pattern !== '') {
    const prx = new RegExp(pattern, 'i')
    urls = urls.filter((u) => prx.test(u))
  }
  return urls
}
