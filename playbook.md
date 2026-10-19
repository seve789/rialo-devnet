# Rialo AGP 参赛手册（seve789）

> 数据来源：`https://api.agp.onlatch.com`（公开可读）+ `agp.onlatch.com` 前端 bundle，实测于 2026-10-20。
> 账号：`@seve789`（GitHub OAuth，scope 仅 `read:user`）。

## 1. 现在的状态

| 项 | 值 |
| --- | --- |
| 赛道总数 | 11 场，**全部 `phase: over`** |
| 最近一场 | `Builder Predict Prelim V2`，2026-09-09 18:40 UTC |
| 开放报名 | **0 场**（`/grid` → OPEN GRIDS 0） |
| 累计参赛 | 106 racers / 10,549 问 / 4,555 guess / 9 finishes |
| 头部花费 | 榜首 spend ≈ $2.41 |

结论：**AGP 已静默约 6 周**。参赛必须先等新赛道开窗，所以现在能做的是"备战 + 盯窗口"，不是"跑比赛"。

## 2. 经济模型（实测字段）

| 字段 | 实测值 | 含义 |
| --- | --- | --- |
| `questionCostUsd` | **0.001** | 每个 yes/no 问题扣 $0.001 |
| `guessCostUsd` | 0.005 – 0.01 | 每次提交猜测扣 $0.005~0.01 |
| `spendCapUsd` | 0.5 – 0.6 | 每个 racer 的信用上限（超线即出局） |
| `chargeCurrency` | `AGP` | 内部计费单位，经 Sigil 用真 USDC 结算上链 |
| `timeLimitSeconds` | 1500 – 1800 | 25–30 分钟硬时限 |
| `pointCount` | 8 – 10 | 每场要攻破的隐藏检查点数 |
| `maxRacers` | 15 – 91 | 网格容量 |
| `invitedOnly` | 最近两场 = **true** | 新场次可能只对受邀者开放，需先确认 |

**排序规则**：先到 FIN 者胜；其余按用时升序，用时相同比问题数少。

## 3. 预算与时间策略

设 8 个点、时限 1500s、cap $0.50：

- 每点预算问题数 `q`：8 × q × 0.001 ≤ 0.20 → q ≤ 25（留余量取 **12–15**）
- 每点最多 1–2 次 guess：8–16 × 0.005 ≈ $0.04–0.08
- 总花费目标 **≤ $0.20**，即 cap 的 40%，绝不在钱上冒进
- 时间目标：每点 ≤ 120s（8 × 120 = 960s，留 540s 缓冲）

**关键**：耗时是主排序键，问题数是 tiebreak。所以策略不是"问得最少"，而是"**每问信息增益最大 + 尽快落guess**"。信息增益优先于省 0.001。

## 4. 提问阶梯（每点的收敛模板）

Oracle 是 OpenRouter 上的 LLM，被硬化过：只回 yes/no，**绝不拼写、翻译、押韵、藏头、暗示**。所以走"属性二分"而不是"字符二分"（后者更容易被判为泄露尝试而被拒或用处不大）：

1. **类别**：是人造物 / 自然物 / 抽象概念 / 生物 / 地点？
2. **规模**：日常尺度 / 宏观 / 微观？
3. **功能或场景**：与交通、居住、食物、通信、计算、娱乐相关？
4. **材质或形态**：金属 / 有机物 / 液体 / 结构化的？
5. **时代**：现代才有 / 古代就有 / 与科技强相关？
6. 以上每层把候选空间切到 ~1/2，8 问 ≈ 256 倍收敛，通常足够落 guess。

被拒或被答"无法回答"时：**立刻换维度**，不要在同一层反复试探（既费钱又耗时）。

## 5. 接入方式（MCP）

- endpoint：`https://api.agp.onlatch.com/track/mcp`（另有 `/puzzle/mcp`）
- 认证：登录后领 **account-bound token**，`Authorization: Bearer <token>`
- 前端给的三种接入位置：Claude Desktop（Settings → Developer → Edit Config）、Claude Code 的 MCP 设置、Codex 的 `~/.codex/config.toml`
- 配置形状（URL 确定，header 以页面 snippet 为准）：

```json
{ "mcpServers": { "agp": {
  "type": "http",
  "url": "https://api.agp.onlatch.com/track/mcp",
  "headers": { "Authorization": "Bearer <MCP_TOKEN>" } } } }
```

## 6. 监控与开赛流程

监控：cron 每 30 分钟对比 `https://api.agp.onlatch.com/track/tracks`，出现新赛道或 `phase` 变成 `registration`/`live` 就提醒。

开窗后按序执行：

1. `GET /track/tracks` → 取目标赛道 `id`、`registrationClosesAt`、`invitedOnly`、`startsAt`
2. 专用 Chrome（`~/rialo-agent/chrome-profile`，CDP 9223）里确认仍登录 seve789 → 取 MCP token
3. 把 token 写进 Claude Code / Codex 的 MCP 配置，重启客户端
4. 在报名窗口内注册 agent 到该 track
5. 绿旗后由 agent 按第 4 节阶梯提问 + 落 guess
6. 赛后 `GET /track/stats/racers/seve789` 与 `/track/stats` 对账：名次、用时、问题数、花费

## 7. 多号扩展时的注意点

- 每个号都要 **独立 GitHub 账号 + 独立 MCP token**；共享 IP/设备跑多号是典型女巫画像
- `invitedOnly` 场次可能直接把新号挡在门外
- 真 USDC 计费 → 多号 = 多份真钱风险，且 cap 是按 racer 计的，不是按账号
- 先跑通 1 个号（seve789）拿到真实名次数据，再决定要不要扩
