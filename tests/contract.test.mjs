/**
 * contract.test.mjs — **源码级契约**（N1 / N2 的机器断言）。
 *
 * 为什么要源码级：文档说 7 个工具、实现写 8 个，运行时看不出来；`output.schema` 里偷偷带一个
 * `value` 字段，也只有读源码才拦得住。故本文件直接读 `src/index.ts` 做集合断言。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8')

/** 设计表 §4.1 的 7 个工具名——**唯一真源是这里**，实现必须与它逐名一致 */
const DESIGNED = [
  'idop_begin',
  'idop_entry',
  'idop_mint',
  'idop_stow',
  'idop_use',
  'idop_ledger',
  'idop_settle',
]

function registeredNames() {
  return [...SRC.matchAll(/name: '(idop_[a-z_]+)'/g)].map((m) => m[1])
}

test('N1 工具面恰为 7 个，且与设计表逐名一致（防「文档 7 个、实现 8 个」）', () => {
  const names = registeredNames()
  assert.deepEqual([...names].sort(), [...DESIGNED].sort())
  assert.equal(names.length, 7)
})

test('N1 工具名前缀一致（idop_）且无旧名残留（id_mail_* / passbook_* / vault_*）', () => {
  assert.ok(registeredNames().every((n) => n.startsWith('idop_')))
  assert.ok(!/name: '(id_mail|passbook_|vault_)/.test(SRC), '源码里出现旧工具名注册')
})

test('N2 **输出契约**里不存在值承载字段（判据打在 output 上，不整段 grep）', () => {
  const outputs = [...SRC.matchAll(/output: (\w+)/g)].map((m) => m[1])
  assert.equal(outputs.length, 7, '每个工具都应有 output 契约')
  assert.ok(outputs.every((o) => o === 'textOut'), '有工具另写了输出契约')
  const schema = /const textOut = \{[\s\S]*?schema: \{[\s\S]*?\}[\s\S]*?\} as const/.exec(SRC)
  assert.ok(schema !== null, 'textOut 形状没找到')
  assert.ok(!/(value|secret|password|totp|recovery)\s*:/.test(schema[0]), 'textOut 的 schema 里出现值承载字段')
})

test('N2 取值的唯一通道是 fetchSecret，且它的返回值不进任何工具返回', () => {
  // fetchSecret 的返回值只允许在本函数与 idop_use 的 env 注入处流转
  const uses = [...SRC.matchAll(/fetchSecret\(/g)].length
  assert.equal(uses, 2, 'fetchSecret 的调用点应恰为「定义 + idop_use 一处」')
  assert.ok(SRC.includes('env: { ...process.env, [envName]: got.value }'), 'env 注入点缺失（唯一合法出口）')
})

test('L3 值零入参：password 只以 passwordStdin 标记出现，stdin 单独传', () => {
  assert.ok(SRC.includes('passwordStdin: useStdin'))
  assert.ok(SRC.includes('useStdin ? args.password : undefined'), 'stdin 通道形状变了')
})

test('L5 审计不反噬：审计写入包 try/catch 且返回 written|failed（不静默）', () => {
  assert.ok(/function appendTrace[\s\S]{0,400}try \{/.test(SRC), 'appendTrace 未包 try')
  assert.ok(SRC.includes("return 'failed'"))
  assert.ok(SRC.includes("return 'written'"))
})

test('L2/L11 旧的值回显工具（passbook_get）在工具面不存在', () => {
  assert.ok(!SRC.includes("'passbook_get'"))
  assert.ok(!/name: 'idop_get'/.test(SRC))
})

test('N6 站点知识写路径先读后改：损坏时拒绝写入（不覆盖真表）', () => {
  assert.ok(SRC.includes('function requireSiteFileForWrite'))
  assert.ok(/requireSiteFileForWrite[\s\S]{0,500}拒绝写入/.test(SRC))
})
