/**
 * loop.test.mjs — 纯逻辑层测试（含设计要求的**成对读数与对照组**）。
 *
 * 纪律（§5.9 规则 2）：恒为空的输出不是证据，对照组不失败 = 实验无结论。
 * 故凡「拒绝」类判据都配一条「同类但不该被拒」的对照。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  auditKeysAllowed,
  auditLine,
  emptySites,
  factsOf,
  looksLikeSecret,
  newOpId,
  opEventLine,
  openOps,
  parseOpLine,
  parseSites,
  parseWrittenFields,
  siteNames,
  unattributedUses,
  upsertFact,
} from '../lib/loop.js'

const op = (opId, event, site = 'x.com', atMs = 1) => ({ atMs, iso: 'i', opId, event, site })

test('opId 形态固定：op-<yyyymmdd>-<6hex>', () => {
  const id = newOpId(new Date('2026-09-23T10:00:00Z'), 'a1b2c3d4')
  assert.equal(id, 'op-20260923-a1b2c3')
  assert.match(newOpId(), /^op-\d{8}-[0-9a-f]{6}$/)
})

test('N10 op 闭环可查：begin 未收口 ⇒ 出现在 openOps；settle 后**消失**（成对读数）', () => {
  const events = [op('op-1', 'begin', 'github.com'), op('op-2', 'begin', 'github.com')]
  assert.equal(openOps(events).length, 2)
  const settled = [...events, op('op-1', 'settle', 'github.com')]
  assert.equal(openOps(settled).length, 1)
  assert.equal(openOps(settled)[0].opId, 'op-2')
  // abandon 同样算收口
  assert.equal(openOps([...settled, op('op-2', 'abandon', 'github.com')]).length, 0)
})

test('openOps 按站点过滤', () => {
  const events = [op('op-1', 'begin', 'a.com'), op('op-2', 'begin', 'b.com')]
  assert.deepEqual(openOps(events, 'a.com').map((o) => o.opId), ['op-1'])
})

test('N18 未归因取用在账上可见（成对读数：带 opId 时计数不变）', () => {
  const unattributed = [op('', 'use'), op('', 'use'), op('op-9', 'use')]
  assert.equal(unattributedUses(unattributed), 2)
  assert.equal(unattributedUses([op('op-1', 'use')]), 0)
})

test('事件行往返：opEventLine → parseOpLine 保形（可选字段不给就不写）', () => {
  const line = opEventLine({ atMs: 5, iso: 'i', opId: 'op-1', event: 'begin', site: 's', purpose: 'p' })
  const back = parseOpLine(line)
  assert.equal(back.opId, 'op-1')
  assert.equal(back.purpose, 'p')
  assert.ok(!('detail' in JSON.parse(line)), '未给的 detail 不该出现在行里')
  assert.equal(parseOpLine('不是 json'), null)
  assert.equal(parseOpLine(''), null)
})

test('N12 站点知识：不存在与损坏是两种事实（修旧件 U3 的静默回落）', () => {
  const missing = parseSites(null)
  assert.equal(missing.ok, false)
  assert.equal(missing.reason, 'missing')
  const corrupt = parseSites('{ not json')
  assert.equal(corrupt.ok, false)
  assert.equal(corrupt.reason, 'corrupt')
  const badShape = parseSites('{"version":1}')
  assert.equal(badShape.ok, false)
  assert.equal(badShape.reason, 'corrupt')
  const good = parseSites('{"version":1,"sites":{}}')
  assert.equal(good.ok, true)
})

test('N11 疑似凭据形态的 facts 被**代码拒绝**；对照组（同形但非凭据）正常写入', () => {
  const file = emptySites()
  const secretish = [
    'ghp_' + 'a'.repeat(30),
    'sk-' + 'b'.repeat(24),
    'AKIA' + 'C'.repeat(16),
    '-----BEGIN RSA PRIVATE KEY-----',
    'password=SuperSecret123',
    'A'.repeat(44),
  ]
  for (const v of secretish) {
    const r = upsertFact(file, { site: 's.com', key: 'k', value: v, source: 'settled', opId: null, compartment: 'alice' })
    assert.ok(r.rejected !== undefined, `未拒绝疑似凭据：${v.slice(0, 12)}`)
  }
  // 对照组：非凭据形态必须能写入（否则「拒绝」无分辨力）
  const ok = upsertFact(file, { site: 's.com', key: 'apiBase', value: 'https://api.s.com/v1', source: 'settled', opId: 'op-1', compartment: 'alice' })
  assert.equal(ok.rejected, undefined)
  assert.equal(factsOf(ok.file, 's.com')[0].value, 'https://api.s.com/v1')
  assert.equal(factsOf(ok.file, 's.com')[0].opId, 'op-1')
  assert.equal(factsOf(ok.file, 's.com')[0].source, 'settled')
})

test('upsertFact 是字段级：同 site 同 key 覆盖，其余键保留；空 site/key 拒绝', () => {
  let file = emptySites()
  file = upsertFact(file, { site: 'a.com', key: 'k1', value: 'v1', source: 'migrated', opId: null, compartment: 'alice' }).file
  file = upsertFact(file, { site: 'a.com', key: 'k2', value: 'v2', source: 'settled', opId: null, compartment: 'alice' }).file
  file = upsertFact(file, { site: 'a.com', key: 'k1', value: 'v1-new', source: 'settled', opId: null, compartment: 'alice' }).file
  const facts = factsOf(file, 'a.com')
  assert.equal(facts.length, 2)
  assert.equal(facts.find((f) => f.key === 'k1').value, 'v1-new')
  assert.equal(facts.find((f) => f.key === 'k2').value, 'v2')
  assert.ok(upsertFact(file, { site: '', key: 'k', value: 'v', source: 'settled', opId: null, compartment: 'alice' }).rejected !== undefined)
  assert.ok(upsertFact(file, { site: 'a.com', key: '  ', value: 'v', source: 'settled', opId: null, compartment: 'alice' }).rejected !== undefined)
})

test('looksLikeSecret：普通事实不误伤（apiBase / tokenPath / 坑点文本）', () => {
  assert.equal(looksLikeSecret('https://api.moltjobs.io/v1'), false)
  assert.equal(looksLikeSecret('localStorage.qrypty_token'), false)
  assert.equal(looksLikeSecret('登录门是 Turnstile，需真人自证'), false)
  assert.equal(looksLikeSecret(''), false)
})

test('siteNames 排序且不受写入顺序影响', () => {
  let file = emptySites()
  for (const s of ['zeta.com', 'alpha.com', 'mid.com']) {
    file = upsertFact(file, { site: s, key: 'k', value: 'v', source: 'migrated', opId: null, compartment: 'alice' }).file
  }
  assert.deepEqual(siteNames(file), ['alpha.com', 'mid.com', 'zeta.com'])
})

test('N7 审计行键集受白名单约束，且**不含值**', () => {
  const line = auditLine({ atMs: 1, tool: 'idop_use', action: 'use', opId: 'op-1', site: 's', field: 'password', outcome: 'ok', detail: 'exit=0 redactions=1', caller: 'sess' })
  assert.equal(auditKeysAllowed(line), true)
  const parsed = JSON.parse(line)
  assert.deepEqual(Object.keys(parsed).sort(), ['action', 'atMs', 'caller', 'detail', 'field', 'iso', 'opId', 'outcome', 'site', 'tool'].sort())
  assert.equal(auditKeysAllowed('{"evil":1}'), false)
  assert.equal(auditKeysAllowed('not json'), false)
  // 对照：把值塞进 detail 也会被白名单放行（detail 是自由文本）⇒ 调用方必须先脱敏
  assert.equal(auditKeysAllowed(auditLine({ atMs: 1, tool: 't', action: 'a', opId: null, outcome: 'ok', detail: 'anything' })), true)
})

test('parseWrittenFields：从 vault set 输出取字段名清单；无匹配 ⇒ 空表（不抛）', () => {
  assert.deepEqual(parseWrittenFields('写入完成 字段=[password,username] ok'), ['password', 'username'])
  assert.deepEqual(parseWrittenFields('字段=[]'), [])
  assert.deepEqual(parseWrittenFields('没有这个格式'), [])
})
