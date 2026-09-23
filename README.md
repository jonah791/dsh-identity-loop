# dsh-identity-loop — 身份闭环

把「**一次身份操作**」当一等实体来承载：**拿到入口 → 落库凭据 → 以该凭据行动 → 沉淀站点知识**，四步挂在同一条 `opId` 下闭环——而不是四次互不相识的工具调用。

替换 `dsh-identity-ops` + `dsh-passbook` + `dsh-vault-meta`（16 工具 → 7）。设计依据：`docs/plans/插件融合设计_身份闭环_2026-09-23.md`；权威契约见 [docs/semantic.md](docs/semantic.md)。

## 为什么需要新件

今天这条链是**四步手工串**，每一步各有一个互不相识的前端（`id_mail_code` → `passbook_set` → `passbook_use` → `id_site_remember`）——搬运工是我。**没有任何一个插件知道这四步属于同一次操作**：三件里不存在任何跨工具的关联标识，也没有任何一处状态记录「这次操作开始了、收口了没有」。

合并只会把这堆差异原样保留在一个新壳里；**替换**才能顺带把「同一次操作」这条主线立起来、把重复面删掉、把与纪律相悖的面取消。

## 最硬的三条

| # | 不变量 | 含义 |
|---|---|---|
| L2 | **值零回显** | 工具面**不存在**任何把凭据值放进返回值的路径——旧 `passbook_get` 已删（能力取消，不是藏起来） |
| L3 | **值零入参** | `password` 走 stdin；`idop_use` 走子进程环境变量——值不进命令行参数 |
| L11 | **单一 owner** | 本件是 vault 元数据的唯一读取面、凭据的唯一写入/取用面 |

## 工具面（7）

| 工具 | 意图 | 敏感类 |
|---|---|---|
| `idop_begin` | 开一次身份操作，拿 `opId` + **离线**简报（站点知识 / vault 字段名 / 未收口 op） | 无 |
| `idop_entry` | 从锚点邮箱取**入口物**：`list` / `body` / `code` / `link` | A 类（可回显、不入库） |
| `idop_mint` | 造一个新秘密并直接落库（**不要自己编密码**） | B 类（写） |
| `idop_stow` | 落库给定字段（字段级合并） | B 类（写） |
| `idop_use` | **以凭据行动**（唯一取用通道；值经 env 注入，输出脱敏） | B 类（用） |
| `idop_ledger` | 看凭据账（非密）+ 体检；`deep` 须 `confirm` | 元数据 |
| `idop_settle` | **收口**：写 op 终态 + 沉淀站点知识（疑似凭据形态被**代码拒绝**） | 无 |

`passbook_selftest` **移出工具面** → `scripts/verify-loop.mjs`（自检是开发者动作，不是「我此刻要做的身份操作」）。

## 配置

| 字段 | 缺省 | 含义 |
|---|---|---|
| `stateDir` | `E:/alice/projects/self/alice-identity/state` | 站点知识 + 操作台账落点 |
| `vaultScript` | `…\alice-identity\scripts\vault.ps1` | DPAPI vault 脚本（**唯一凭据通道**） |
| `proxy` | `http://127.0.0.1:16888` | 邮件面出网（**fail-closed，绝不裸连**） |
| `traceFile` | 空 ⇒ `<DSH_HOME>/identity-loop-trace.jsonl` | 审计（**永不含值**） |
| `rotationDays` | 180 | 体检的轮换阈值 |
| `compartment` | `alice` | 隔间名（写入站点知识） |

## 生效判据

1. **构建-进程先后**：`lib/index.js` 的 mtime 晚于 web 进程启动时间。
2. **工具可答**：`idop_begin` 能返回 `opId` 与简报。
3. **单一 owner 取证**：`grep -rn 'vault.ps1' self-plugins/*/src/*.ts` 只有本件命中写/取用子命令。
4. **落盘产物**：`state/ops.jsonl`、`state/sites.json` 出现且 mtime 前进。

## 迁移

```
node scripts/migrate-site-registry.mjs            # 复制不移动（打印前后 sha256）
```

## 回退

`plugin_mount dsh-identity-ops` / `dsh-passbook`（旧工具名立刻恢复）；数据面零成本——旧件从未被本件写过，vault 是同一份库、只被按同一套子命令调用。
