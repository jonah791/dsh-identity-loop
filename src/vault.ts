/**
 * vault.ts — DPAPI vault 的**唯一调用通道**（承 `dsh-passbook`，通道不变）。
 *
 * 已做对的部分原样保留：`buildVaultArgs` 决定参数形状，`password` 只以 `-PasswordStdin` 标记出现
 * （**值走 stdin，不进 argv**），退出码六类语义由 `classifyExit` 区分。
 */

import { spawn } from 'node:child_process'
import { buildVaultArgs, classifyExit } from './passbook.js'

export interface VaultConfig {
  readonly vaultScript: string
  readonly vaultPath: string
  readonly powershell: string
  readonly timeoutMs: number
}

export interface RunResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

type VaultAction = Parameters<typeof buildVaultArgs>[0]
type VaultParams = Parameters<typeof buildVaultArgs>[1]

/** 调用 `vault.ps1`。`stdin` 只在 password 通道使用（值不进命令行） */
export function runVault(
  config: VaultConfig,
  action: VaultAction,
  params: VaultParams = {},
  stdin?: string,
): Promise<RunResult> {
  const argv = buildVaultArgs(action, {
    ...params,
    vaultPath: params.vaultPath ?? (config.vaultPath || undefined),
  })
  const args = argv.map((a) => (a === '@SCRIPT@' ? config.vaultScript : a))
  return new Promise<RunResult>((resolve) => {
    const child = spawn(config.powershell, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        /* 已退出 */
      }
      resolve({ code: null, stdout, stderr, timedOut: true })
    }, config.timeoutMs)
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    child.on('error', (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: stderr + err.message, timedOut: false })
    })
    child.on('close', (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut: false })
    })
    if (stdin !== undefined) child.stdin.write(stdin, 'utf8')
    child.stdin.end()
  })
}

export function stdoutText(r: RunResult): string {
  return r.stdout.trim()
}

/** 失败语义（六类退出码 → 语义化文案；超时单独一类；**不冒充成功**） */
export function failureOf(r: RunResult, extra?: string): { ok: false; kind: string; text: string } {
  const info = classifyExit(r.code)
  const detail = [stdoutText(r), r.stderr.trim(), extra].filter(Boolean).join(' | ')
  return {
    ok: false,
    kind: r.timedOut ? 'timeout' : info.kind,
    text: `${info.meaning}${detail ? `：${detail}` : ''}`,
  }
}
