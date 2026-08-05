# FXPulse Cloudflare 部署指南

版本：v1.2<br>
更新时间：2026-08-05

## 1. 生产配置

| 项目 | 值 |
|---|---|
| Worker | `fxpulse` |
| D1 Binding | `DB` |
| D1 Database | `fxpulse-db` |
| Static Assets Binding | `ASSETS` |
| Cron | `*/15 * * * *` |
| Production branch | `main` |
| 自定义域名 | `fxpulse.177.best` |

所有已注册来源均通过匿名公开接口或公开聚合页获取，生产环境不需要 `WISE_API_TOKEN`、`HSBC_INGEST_TOKEN`、银行账号、Cookie 或登录会话。需要登录的银行报价不得加入来源配置。

## 2. 首次部署

安装并校验：

```bash
npm ci
npm run check
```

应用 D1 迁移：

```bash
npm run db:migrate:remote
```

直接部署：

```bash
npm run deploy
```

如果使用 Cloudflare GitHub 自动部署：

| 配置 | 内容 |
|---|---|
| Repository | `wxywizard/FXPulse` |
| Branch | `main` |
| Build command | `npm run check` |
| Deploy command | `npx wrangler deploy` |
| Node | 22 或更高 |

`wrangler.jsonc` 已包含 D1 Binding、Static Assets 与 Cron 配置。D1 `database_id` 是资源标识符，不是密码；API Token、Global API Key 等凭据不能提交到仓库。

## 3. D1 表验证

在 Cloudflare D1 Console 执行：

```sql
SELECT name
FROM sqlite_schema
WHERE type = 'table'
  AND name IN ('rate_snapshots', 'provider_rate_snapshots')
ORDER BY name;
```

应看到两张表。`provider_rate_snapshots` 用于 Wise、汇丰及用户访问过的香港银行币种对归档；即使该表暂时不可用，页面仍会读取实时接口，但没有相应来源的历史与故障降级能力。

## 4. 上线验收

健康检查：

```bash
curl "https://fxpulse.177.best/api/health"
```

检查 `USD/AUD`：

```bash
curl "https://fxpulse.177.best/api/compare?base=USD&quote=AUD"
```

检查反向 `AUD/USD`：

```bash
curl "https://fxpulse.177.best/api/compare?base=AUD&quote=USD"
```

两份响应都应包含：

```text
market
wise
hsbc_public
```

并满足：

- Wise 与汇丰无需 Secret 即返回数字；
- 汇丰 `basis` 显示 `BASE TT Buy ÷ QUOTE TT Sell` 或对应 HKD 单边公式；
- 汇丰正反向不是简单倒数，因为 TT 买卖价差被保留；
- 每项来源有独立更新时间与状态；
- 页面反转按钮会同步更新 URL、计算器、统一来源表和走势图。

检查香港银行排行：

```bash
curl "https://fxpulse.177.best/api/banks?base=AUD&quote=USD"
```

银行排行响应应满足：

- 银行接口固定返回 18 家银行及每行可用状态，汇丰行为官方直连；页面 `#banks` 表格按可得目标币种数量从高到低排序。

检查可配置总览：

```bash
curl "https://fxpulse.177.best/api/overview?base=AUD&sources=hsbc_public,bank_boc"
```

响应中的每个币种对都应包含固定的 `market`、`wise`，并在可用时包含请求的额外来源；页面全局和单卡配置都应拒绝选择超过 5 个额外来源。

检查多来源历史：

```bash
curl "https://fxpulse.177.best/api/history?base=AUD&quote=USD&days=30&sources=market,wise,hsbc_public,bank_boc"
```

响应应固定包含 `market` 与 `wise`；除这两项外最多接受 5 个来源，第 6 个额外来源应返回 `400 Too many history sources`。

公共市场应返回可用序列；Wise、汇丰或银行归档不足时应返回带原因的 `unavailable`，不得复制公共市场点位。

页面验收地址：

- `https://fxpulse.177.best/rates/usd/aud`
- `https://fxpulse.177.best/rates/aud/usd`

## 5. Cron 验证

部署 15 分钟后在 D1 Console 执行：

```sql
SELECT provider,
       COUNT(*) AS rows,
       datetime(MAX(observed_at), 'unixepoch') AS latest_utc
FROM provider_rate_snapshots
GROUP BY provider
ORDER BY provider;
```

预期：

- `hsbc_public` 每 15 分钟最多写入 110 个有向币种对；
- `wise` 每小时最多写入 20 个 USD 双向币种对；
- `bank_*` 每小时从 10 个银行币种页推导并分批写入全部可用方向；页面访问相应币种对时也按小时桶补充；
- 早于 400 天的数据由 Cron 清理。

## 6. 故障判断

| 现象 | 检查 |
|---|---|
| 核心来源全部失败 | 检查 Worker 出站网络、构建版本与 `/api/health` |
| Wise 显示归档/暂不可用 | 检查 Worker 日志中的 `Wise public quote unavailable` |
| 汇丰显示归档/暂不可用 | 检查 Worker 日志中的 `HSBC public quote unavailable` |
| 汇丰牌价方向不符 | 确认页面含义是“卖出 BASE、买入 QUOTE”，并核对 `basis` |
| 切换后仍显示旧币种 | 强制刷新页面并确认页面加载最新 `app.js` 资产版本 |
| 没有归档 | 确认 `0002_create_provider_rate_snapshots.sql` 已执行且 Cron 存在 |

## 7. 回滚

代码回滚应通过 Git revert 创建新提交并推送 `main`，由 Cloudflare 自动重新部署。不要删除 D1 表；现有公共市场、Wise、汇丰和银行快照与前一版本兼容。
