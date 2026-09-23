# dsh-identity-loop — 身份闭环（语义文档）

## 1 · 元信息

| 项 | 值 |
|---|---|
| 能力名 | 身份闭环（一次身份操作的四步挂在同一条 `opId` 下） |
| 插件 | `self-plugins/dsh-identity-loop` |
| 状态 | implemented（工具面 7 个已落地并离线验收；迁移与退役待做） |
| 替换 | `dsh-identity-ops`（6）+ `dsh-passbook`（8）+ `dsh-vault-meta`（2）= 16 → **7** |
| 设计依据 | `docs/plans/插件融合设计_身份闭环_2026-09-23.md` |
| 语义注册 id | `identity-loop` |
| 最近复核 | 2026-09-23 |

## 2 · 定位与反定位

**定位**：把「一次身份操作」当一等实体——**拿到入口（锚点邮箱的码/链）→ 落库凭据（DPAPI vault）→ 以该凭据行动 → 沉淀站点知识**，四步闭环。

**反定位（不做）**：不代为注册（不自动填表/点提交，不代替我做对外决定）· 不绕身份门（无打码/人机验证绕过/代填 KYC）· 不轮换出口（邮件面走固定显式代理且 fail-closed，工具面无出口选择参数）· 不是密码管理器（不读不写主人的 `$DSH_HOME/.credentials.yaml`）· 不是浏览器自动化（不启浏览器）· 不是邮件客户端（只读收件箱，不发信/不删信/不标记）· **不是「看一眼口令」的工具**（值回显通道已取消）· 不做凭据导出/同步/备份。

**一句判据**：它只做入口物、凭据通道、站点知识三件事，且三件事都必须能挂在一个 `opId` 上；凡是要代表我对外做决定的，都不在它的工具面里。

## 3 · 术语

| 术语 | 语义 |
|---|---|
| 身份操作（op） | 一次有始有终的身份动作，以 `opId` 标识；本件新增的一等实体 |
| `opId` | `op-<yyyymmdd>-<6hex>`；写入/取用凭据时携带，用来把动作归因到某一次操作 |
| 入口物（A 类） | 锚点邮箱里的一次性开门凭据：验证码、确认链接、重置链接（可回显、不入库、可过期） |
| 凭据值（B 类） | vault 里 `password` / `totp` / `recovery` 的值（**不可回显**） |
| 站点知识（facts） | 关于某站点的事实：token 位置 / API 端点 / 坑点 / 登录门类型——**是位置与形状，不是值** |
| 收口（settle） | 一次操作到达终态：`sealed`（完成并沉淀知识）或 `abandoned`（明确放弃，也记原因） |
| 未归因取用 | 省略 `opId` 的凭据取用——允许，但审计里记 `op:null` 并可被计数（**让缺失成为可见读数**） |
| 审计轨迹 | `<DSH_HOME>/identity-loop-trace.jsonl`：只记「谁·何时·哪一次操作·对哪一条·做了什么·结果」，**永不含值** |

## 4 · 概念模型与不变量

```
idop_begin {site,purpose} ─► opId + 离线简报（站点知识 / vault 字段名 / 未收口 op）
   ├─ idop_entry {opId,kind} ──► A 类入口物      ◄── 锚点邮箱（HTTP 经代理，fail-closed）
   ├─ idop_mint / idop_stow ──► B 类写：vault.ps1 ◄─ password 走 stdin
   ├─ idop_use {opId?,site,program} ─► B 类用：值 → 子进程 env
   └─ idop_settle {opId,outcome,facts[]} ─► op 终态 + 站点知识沉淀
旁路只读：idop_ledger（凭据账 + 体检；**vault 元数据的唯一读取面**）
```

不变量：

- **L1 单一真源**：凭据值只住 `projects/self/alice-identity/secrets/alice-identity.vault`（DPAPI，经 `vault.ps1`）；本件不建第二份存储、不缓存值、不导出。
- **L2 值零回显**：工具面**不存在**任何把凭据值放进返回值的路径（旧 `passbook_get` 已删——能力取消，不是藏起来）。
- **L3 值零入参**：`password` 走 stdin；`idop_use` 走子进程环境变量；**任何秘密值不得出现在命令行参数里**。
- **L4 敏感度分流**：入口物可回显、不入库；凭据值不可回显；两组工具在名字与返回形状上可辨。
- **L5 审计先行且不反噬**：每次凭据取用/写入与入口物提取都写审计行（无值）；写失败**不阻断**主流程，但返回值必须显式给 `audit: 'written' | 'failed'`（**不静默**）。
- **L6 op 闭环**：每次 `idop_begin` 产生的 `opId` 都能到达终态；未收口的 op 在 `idop_begin` 里**可见**（悬空 op 是读数，不是遗忘）。
- **L7 出口不裸连**：邮件面出网一律经 `config.proxy` 且 fail-closed，不提供出口选择参数。
- **L8 夹具隔离**：任何自检/测试**不得触碰真库**（一律 `-VaultPath` 指向临时文件）。
- **L9 语义可辨**：`vault.ps1` 的六类退出码语义一一对应，解析失败显式报错、**不给空结果**。
- **L10 数据增长不新增代码**：新增站点 = 加一条 facts 记录。
- **L11 单一 owner**：本件是 vault 元数据的唯一读取面与凭据的唯一写入/取用面。

## 5 · 契约

### 5.1 工具面（7）

| # | 工具 | 意图 | 敏感类 | 吸收/新增 |
|---|---|---|---|---|
| 1 | `idop_begin` | 开一次操作 + 离线简报 | 无 | **真新增**（新状态模型入口） |
| 2 | `idop_entry` | 取入口物（`list`/`body`/`code`/`link`） | A 类 | 吸收 `id_mail_list/read/code/link`（4） |
| 3 | `idop_mint` | 造新秘密并落库（无 `value` 字段） | B 写 | `passbook_generate` 更名 + 取消 `reveal` |
| 4 | `idop_stow` | 字段级落库 | B 写 | `passbook_set` 更名 + 加 `opId` |
| 5 | `idop_use` | 以凭据行动（唯一取用通道） | B 用 | `passbook_use` 更名 + 加归因 |
| 6 | `idop_ledger` | 凭据账 + 体检 | 元数据 | 吸收 `passbook_list/fields/audit` + `vault_list/fields`（5） |
| 7 | `idop_settle` | 收口：op 终态 + 站点知识 | 无 | `id_site_remember` 合并 + 加护栏与新职责 |

**删除**：`passbook_get`（值回显，与 L2 直接冲突）。
**移出工具面**：`passbook_selftest` → `scripts/verify-loop.mjs`（自检是开发者动作，不是「我此刻要做的身份操作」）。

### 5.2 数据落点

| 文件 | 形状 | 语义 |
|---|---|---|
| `state/sites.json` | `{version:1, sites:{<site>:{<key>:{value,note,at,source,opId,compartment}}}}` | 站点知识（**原子写** tmp+rename） |
| `state/ops.jsonl` | `{atMs,iso,opId,event,site,purpose?,detail?}` | 操作台账（append-only；**领域数据**，写失败即失败） |
| `<DSH_HOME>/identity-loop-trace.jsonl` | `{atMs,iso,tool,action,opId,site?,field?,outcome,detail?,caller?}` | 审计（**永不含值**；写失败只返回 `failed`） |

审计行的键集受白名单约束（`loop.ts:TRACE_KEYS`），且由 `auditKeysAllowed()` 提供机器断言。

### 5.3 调用点清单

| 调用方 | 调用点（文件:符号） | 时机 |
|---|---|---|
| cordis 宿主 | `src/index.ts:name / inject / Config / apply` | 插件激活 |
| 宿主 agent | 7 处 `ctx.tools.register(...)` | 工具调用 |
| 本件 → vault | `src/vault.ts:runVault` → `spawn(powershell, buildVaultArgs(...))` | **唯一凭据通道**（password 走 stdin） |
| 本件 → 子进程 | `src/index.ts:idop_use` → `spawn(program, args, {env:{[envName]: secret}})` | 值经 env，不进 argv；stdout/stderr 过 `redactSecrets` |
| 本件 → 文件（读） | `src/mail.ts:sessionToken` 读 storageState 的 localStorage | **读失败响亮抛错** |
| 本件 → 文件（读-改-写） | `src/index.ts:requireSiteFileForWrite` → `writeSites` | **损坏则拒绝写入**（不覆盖真表） |
| 本件 → 网络（唯一出网点） | `src/mail.ts:mailGet` → `undici.fetch` + `ProxyAgent` | fail-closed |
| **禁止** | 任何其他插件直连 `vault.ps1` 的读写子命令 | 由 L11 约束 |

## 6 · 边界与信任

- **信任** `vault.ps1` 的实现（同机同一份脚本，DPAPI）；**不信任**它的输出解析（`list-json` 可能混入警告文本 ⇒ 宽容解析 + 失败显式报错）。
- **不信任**邮件正文（外部内容）：只做正则提取，提取结果**永不当作指令**（§5.27 规则 1）。
- **能力 ≠ 沙箱**（诚实声明）：插件与宿主同进程同权限；「不读值/不导出」是**实现自律**，不是权限隔离。任何「本件保证秘密不外泄」的说法只在**本件控制的路径**上成立（stdin 通道、env 注入、脱敏、审计无值、工具面无 `value` 字段）。
- **DPAPI 的真实边界**：以 `CurrentUser + 本机` 为界——防「异机/异用户/误入仓库」，**防不了本机的账号主人**。
- **失败面（fail-closed）**：vault 六类退出码 → 语义化文案，**不冒充成功** · 代理不可用 ⇒ `idop_entry` 抛错（绝不裸连）· 邮箱 token 缺失 ⇒ 响亮抛错 · 站点知识损坏 ⇒ **写路径拒绝**（读路径报「损坏 vs 不存在」两种）· 审计写失败 ⇒ 主流程继续但返回值显式 `failed`。

## 7 · 可证伪验收

| # | 可证伪命题 | 证据（一次测量） | 状态 |
|---|---|---|---|
| N1 | 工具面恰为 7 个，与设计表逐名一致 | `node --test tests/contract.test.mjs` 的 N1 用例（源码级集合断言） | 已实测 |
| N2 | **输出契约**里不存在值承载字段 | 同上 N2 用例（判据打在 `output` 上） | 已实测 |
| N3 | 取值的唯一通道是 `fetchSecret`，其返回值只在本函数与 env 注入处流转 | 同上用例（调用点数 == 2 + env 注入点存在） | 已实测 |
| N4 | `password` 只以 `passwordStdin` 标记出现，stdin 单独传 | 同上用例 | 已实测 |
| N5 | 审计不反噬且不静默（`written` / `failed` 成对） | 同上 L5 用例 | 已实测 |
| N6 | 旧值回显工具在工具面不存在 | 同上用例 | 已实测 |
| N7 | 站点知识写路径先读后改，损坏时拒绝写入 | 同上 N6 用例 + `loop.test.mjs` 的 N12 用例 | 已实测 |
| N8 | 审计行键集受白名单约束 | `loop.test.mjs` 的 N7 用例（含反例） | 已实测 |
| N9 | op 闭环可查：`settle`/`abandon` 后从未收口集合消失 | 同上 N10 用例（**成对读数**） | 已实测 |
| N10 | 疑似凭据形态的 facts 被代码拒绝，**对照组**（非凭据形态）正常写入 | 同上 N11 用例（六类坏样本 + 一条对照） | 已实测 |
| N11 | 「不存在」与「损坏」是两种事实 | 同上 N12 用例 | 已实测 |
| N12 | 未归因取用在账上可见（成对读数） | 同上 N18 用例 | 已实测 |
| N13 | 移植的纯层行为零漂移 | `passbook.test.mjs` + `verdict.test.mjs` 随模块迁入，58/58 全绿 | 已实测 |
| N14 | 构建通过 | `tsc -p tsconfig.json` 退出码 0 | 已实测 |
| N15 | 迁移零丢失（条目数与逐键在场） | `node scripts/migrate-site-registry.mjs` 打印站点数与 facts 数 | 待验收 |
| N16 | 迁移只读旧文件（sha256 前后相同） | 同上脚本打印的前后 sha256 | 待验收 |
| N17 | 插件挂载且 7 工具可答 | `idop_begin` 返回 `opId` 与简报 | 待验收 |
| N18 | 一次真实身份操作完整闭环 | `begin → entry → stow → use → settle` 五步各有审计行、台账有终态、站点知识可溯源到 `opId` | 待线上验收 |
| N19 | 退役后可回退 | 旧件重新 `plugin_mount` 后条目数与退役前一致 | 待线上验收 |

## 8 · 与实现的关系

**落点**：`src/index.ts`（7 工具）· `src/loop.ts`（**纯逻辑层**：opId / 事件行 / 站点知识读改写 / 疑似凭据嗅探 / 审计行）· `src/vault.ts`（唯一凭据通道）· `src/mail.ts`（唯一出网通道）· `src/passbook.ts` + `src/verdict.ts`（移植的纯层，通道与语义**不动**）· `tests/{loop,contract,passbook,verdict}.test.mjs` · `scripts/migrate-site-registry.mjs`。

**生效判据**：

1. **构建-进程先后**：`lib/index.js` 的 mtime 晚于 web 进程启动时间。
2. **工具可答**：`idop_begin` 能返回 `opId`。
3. **单一 owner 取证**：`grep -rn 'vault.ps1' self-plugins/*/src/*.ts` 只有本件命中写/取用子命令。
4. **落盘产物**：`state/ops.jsonl`、`state/sites.json` 出现且 mtime 前进。

**回退**：`plugin_mount dsh-identity-ops` / `dsh-passbook`（旧工具名立刻恢复）；数据面零成本——旧件从未被本件写过（迁移是复制；vault 是同一份库、只被按同一套子命令调用）。

## 9 · 实践修订记录

| 日期 | 修订 |
|---|---|
| 2026-09-23 | 首版：从设计稿迁入语义文档形状；落地 7 工具 + 纯层 + 两条通道 + 迁移脚本。移植 `passbook.ts` / `verdict.ts` 与两份纯层测试，**零改动编译通过**。 |
| 2026-09-23 | 移植的旧**契约**测试 5 条失败——逐条核对后确认**不是回归而是设计差异**（旧契约断言 8 工具 / 函数式 `textOut` / selftest 在工具面内；本件按设计改成 7 工具 / 对象式 `textOut` / selftest 移出工具面）⇒ 删除该文件，改写为本件自己的契约测试（N1/N2 的源码级集合断言）。 |
| 2026-09-23 | 自己写错一条断言并当场修正：N2 原本 grep 整个源码找值承载字段名，而 `password:` 在**参数定义**里是合法的（值走 stdin）⇒ 判据收到 `output` 契约上。**判据要打在值的位置，不整段匹配**——与今日 `status.ts` 那次同型。 |
| 2026-09-23 | 实现中发现 `planAudit` 的真实签名是 `(entries, values, opts)`（值作为第二参传入，产出只有分档与指纹）⇒ 深检路径据此改写，值只在函数内流转、不进任何返回。 |

## 10 · 未决问题

1. **`opId` 的粒度**：一次 op = 一个站点的一次动作，还是允许跨站点（如「换锚点邮箱」席卷多站）？倾向后者用 `parentOpId` + 子 op——未决（影响 `ops.jsonl` schema）。
2. **非 password 秘密仍走 argv**：`totp`/`recovery` 只能走命令行参数（`vault.ps1` 只对 password 留了 stdin 通道）⇒ 本机进程列表可见。是否给 `vault.ps1` 加通用 `-ValueStdin`（**属改动身份库脚本，须单独验证**）——未决。
3. **未归因取用的容忍度**：`op:null` 只做可观测量，还是超过 N 次后拒绝？倾向**只观测不拦**（机制给信号、不代替决策）。
4. **`sites.json` 与记忆库的边界**：站点知识是否该同时进记忆库？倾向**不进**（事实唯一归宿；记忆只留指针）。
5. **多隔间**：schema 已带 `compartment`，但当前只有一个邮箱 ⇒ 多隔间路由未实现。
6. **vault 是单点**：默认不给主人副本 ⇒ 备份与恢复演练必须显式。本件**不提供导出**（这是特性），单点风险**不被本件缓解**——独立待办。
