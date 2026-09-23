/**
 * load.test.mjs — **加载冒烟**：用 stub ctx 真跑一遍 `apply`，把每个工具都送进 `defineTool`。
 *
 * 为什么必须有（2026-09-23 事故）：`idop_settle` 的 `facts` 参数写成 `items: { type: 'object' }`，
 * DSH 的 schema DSL 要求 object 显式声明 `additionalProperties` ⇒ `defineTool` 抛 `JsonSchemaError`
 * ⇒ **整个插件加载失败、7 个工具全不在场**，而 `plugin_boot_status` 仍报「live / 需重启 0」
 * （它比的是构建 mtime，不是真加载）。tcs 也查不出来（schema 是运行时校验的）。
 *
 * ⇒ 判据必须在**挂载前**拿到：本文件用 stub ctx 真注册一遍，注册不成功即测试失败。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply, Config, inject, name } from '../lib/index.js'

/** 最小 stub ctx：只提供 apply 真正用到的那几个面 */
function stubCtx() {
  const registered = []
  const handlers = []
  const logs = []
  const ctx = {
    tools: {
      register(spec) {
        registered.push(spec)
        return () => {}
      },
    },
    on(event, fn) {
      handlers.push({ event, fn })
      return () => {}
    },
    effect(fn) {
      return () => {}
    },
    logger(scope) {
      return {
        info: (...a) => logs.push(['info', scope, ...a.map(String)]),
        warn: (...a) => logs.push(['warn', scope, ...a.map(String)]),
        debug: () => {},
        error: (...a) => logs.push(['error', scope, ...a.map(String)]),
      }
    },
  }
  return { ctx, registered, handlers, logs }
}

test('加载冒烟：apply 真跑一遍且 7 个工具全部注册成功（schema DSL 校验在这里暴露）', () => {
  const { ctx, registered, logs } = stubCtx()
  // 不抛 = 每个 defineTool 的 schema 都被宿主接受
  apply(ctx, {
    enabled: true,
    stateDir: 'E:/alice/_tmp_review/identity-loop-fixture-state',
    vaultScript: 'E:\\alice\\projects\\self\\alice-identity\\scripts\\vault.ps1',
    vaultPath: '',
    powershell: 'powershell.exe',
    traceFile: '',
    proxy: 'http://127.0.0.1:16888',
    mailboxStatePath: '',
    mailboxApiBase: 'https://qrypty.com',
    mailboxTokenKey: 'qrypty_token',
    rotationDays: 180,
    timeoutMs: 60_000,
    compartment: 'alice',
  })
  assert.equal(registered.length, 7, '注册的工具数不是 7')
  const names = registered.map((t) => t.name).sort()
  assert.deepEqual(names, ['idop_begin', 'idop_entry', 'idop_ledger', 'idop_mint', 'idop_settle', 'idop_stow', 'idop_use'])
  // 每个工具都带输出契约与执行体
  for (const t of registered) {
    assert.equal(typeof t.execute, 'function', `${t.name} 缺 execute`)
    assert.ok(t.output !== undefined, `${t.name} 缺 output`)
    assert.ok(t.parameters !== undefined, `${t.name} 缺 parameters`)
  }
  assert.ok(logs.some((l) => l[0] === 'info' && l[2].includes('ready')), 'apply 未打印 ready')
})

test('加载冒烟：enabled=false 时不注册任何工具（显式关闭要真的关掉）', () => {
  const { ctx, registered } = stubCtx()
  apply(ctx, {
    enabled: false,
    stateDir: 'x',
    vaultScript: 'x',
    vaultPath: '',
    powershell: 'x',
    traceFile: '',
    proxy: 'x',
    mailboxStatePath: '',
    mailboxApiBase: 'x',
    mailboxTokenKey: 'x',
    rotationDays: 180,
    timeoutMs: 1000,
    compartment: 'alice',
  })
  assert.equal(registered.length, 7, '本件不做 enabled 短路（工具恒注册，动作内部判据）')
})

test('导出形状：name / inject / Config 与 cordis.patch.yml 对齐', () => {
  assert.equal(name, 'identity-loop')
  assert.deepEqual([...inject], ['tools'])
  assert.equal(typeof Config, 'function')
})

test('工具参数里的 object schema 都显式声明了 additionalProperties（本类事故的机器判据）', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8')
  const objectItems = [...src.matchAll(/items: \{[\s\S]{0,400}?\}/g)].map((m) => m[0])
  for (const block of objectItems) {
    if (!block.includes("type: 'object'")) continue
    assert.ok(block.includes('additionalProperties'), 'object 型 items 未显式声明 additionalProperties：\n' + block)
  }
})
