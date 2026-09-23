/**
 * 脚本输出 → 结构化裁决。纯函数，无 IO，可离线测（t-ef0af5ff 缺陷 ② 的判据载体）。
 *
 * 存在理由：旧模板的收尾 `if (typeof __raw === 'object' && 'ok' in __raw)` **恒假**
 * （execute 体约定返回字符串）⇒ 该分支是死代码，脚本级 ok:false 从不生效、失败被报成成功。
 */

export interface Verdict {
  ok: boolean
  text: string
}

function asVerdict(parsed: unknown, fallbackText: string): Verdict | null {
  if (parsed === null || typeof parsed !== 'object' || !('ok' in (parsed as Record<string, unknown>))) return null
  const o = parsed as { ok: unknown; text?: unknown; error?: unknown }
  const detail = o.text ?? o.error
  // 只认布尔 true 为成功——字符串 "false"/1/缺失一律判失败（宁可误报失败，不冒充成功）
  return { ok: o.ok === true, text: typeof detail === 'string' ? detail : fallbackText }
}

/** 整段先试，失败则**自末行向上**回扫——stdout+stderr 合并会把警告行混进正文（既有约定）。 */
function parseVerdict(raw: string): Verdict | null {
  const text = raw.trim()
  const whole = ((): unknown => { try { return JSON.parse(text) } catch { return undefined } })()
  const hit = asVerdict(whole, text)
  if (hit) return hit
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim()
    if (!line.startsWith('{')) continue
    const parsed = ((): unknown => { try { return JSON.parse(line) } catch { return undefined } })()
    const v = asVerdict(parsed, line)
    if (v) return v
  }
  return null
}

/**
 * 把脚本输出解释成裁决。
 *
 * @param raw           脚本的 stdout+stderr 合并文本
 * @param okOnPlainText 输出**里没有**结构化裁决时，按什么判定（调用成功传 true；调用抛错传 false）
 */
export function verdictFrom(raw: string, okOnPlainText: boolean): Verdict {
  return parseVerdict(raw) ?? { ok: okOnPlainText, text: raw.trim() }
}
