/**
 * t-ef0af5ff 回归：脚本裁决解析必须真的有分辨力。
 * 对照组齐备：同一段 JSON，ok:true 与 ok:false 必须给出**不同**结论——
 * 否则「恒 true」和「恒 false」也能全绿（本卡缺陷 ② 的本质就是判定分支没接线）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { verdictFrom } = await import('../lib/verdict.js')

test('脚本吐 ok:false ⇒ 必须判失败（旧模板这里恒报成功）', () => {
  const v = verdictFrom('{"ok":false,"error":"vault.ps1: entry not found"}', true)
  assert.equal(v.ok, false)
  assert.equal(v.text, 'vault.ps1: entry not found')
})

test('对照组：同一形状的 ok:true ⇒ 必须判成功', () => {
  const v = verdictFrom('{"ok":true,"text":"2 entries"}', false)
  assert.equal(v.ok, true, 'okOnPlainText=false 不得压过脚本自己的 ok:true')
  assert.equal(v.text, '2 entries')
})

test('对照组：非 JSON 纯文本 ⇒ 由调用方裁决（成功路径 true / 抛错路径 false）', () => {
  assert.equal(verdictFrom('nearai-market\nopenai', true).ok, true)
  assert.equal(verdictFrom('nearai-market\nopenai', false).ok, false)
})

test('只有布尔 true 算成功：字符串 "false" / 缺失 / 0 一律判失败', () => {
  assert.equal(verdictFrom('{"ok":"false"}', true).ok, false, '字符串 "false" 不得被当真')
  assert.equal(verdictFrom('{"ok":1}', true).ok, false)
  assert.equal(verdictFrom('{"text":"no verdict"}', true).ok, true, '无 ok 字段 ⇒ 不是裁决，退回 okOnPlainText')
})

test('stderr 混进正文时仍能取到裁决（stdout+stderr 合并是既有约定）', () => {
  const v = verdictFrom('WARNING: deprecated flag\n{"ok":false,"error":"boom"}', true)
  assert.equal(v.ok, false)
  assert.equal(v.text, 'boom')
})
