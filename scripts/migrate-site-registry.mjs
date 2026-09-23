/**
 * migrate-site-registry.mjs — 站点知识迁移：旧 `site-registry.json` → 新 `sites.json`。
 *
 * 三条纪律（设计稿 §9.1 步骤 2 + N14/N15）：
 * 1. **复制不移动**：旧文件一字不改，跑完打印前后 sha256（判据：相同）；
 * 2. **纯加字段**：旧形状 `{value,note,at}` 逐字段保留，新增 `source:'migrated'` / `opId:null` / `compartment`；
 * 3. **只读旧文件**，新文件原子写（tmp + rename）。
 *
 * 用法：node scripts/migrate-site-registry.mjs [--state-dir <dir>] [--compartment alice] [--dry-run]
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const stateDir = opt('--state-dir', 'E:/alice/projects/self/alice-identity/state')
const compartment = opt('--compartment', 'alice')
const dryRun = args.includes('--dry-run')

const oldPath = join(stateDir, 'site-registry.json')
const newPath = join(stateDir, 'sites.json')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

if (!existsSync(oldPath)) {
  console.error(`旧注册表不存在：${oldPath}`)
  process.exit(2)
}
const oldBuf = readFileSync(oldPath)
const before = sha256(oldBuf)
const old = JSON.parse(oldBuf.toString('utf8'))
const sites = old?.sites ?? {}

const next = { version: 1, sites: {} }
let factCount = 0
for (const [site, facts] of Object.entries(sites)) {
  next.sites[site] = {}
  for (const [key, fact] of Object.entries(facts ?? {})) {
    const f = fact ?? {}
    next.sites[site][key] = {
      value: String(f.value ?? ''),
      note: String(f.note ?? ''),
      at: String(f.at ?? new Date().toISOString()),
      source: 'migrated',
      opId: null,
      compartment,
    }
    factCount += 1
  }
}

console.log(`旧注册表：${oldPath}`)
console.log(`  站点 ${Object.keys(sites).length} 个 · facts ${factCount} 条 · sha256 ${before.slice(0, 16)}…`)
if (dryRun) {
  console.log('（dry-run：未写入）')
  process.exit(0)
}

mkdirSync(stateDir, { recursive: true })
const tmp = newPath + '.tmp'
writeFileSync(tmp, JSON.stringify(next, null, 1), 'utf8')
renameSync(tmp, newPath)

const after = sha256(readFileSync(oldPath))
console.log(`新文件：${newPath}`)
console.log(`  站点 ${Object.keys(next.sites).length} 个 · facts ${factCount} 条`)
console.log(`旧文件 sha256 前后：${before === after ? '相同 ✔（复制不移动）' : '不同 ✗'}`)
console.log(`旧文件 sha256：${after}`)
process.exit(before === after ? 0 : 3)
