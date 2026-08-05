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

公共市场、Wise 和汇丰公开牌价均通过匿名公开接口获取，生产环境不需要 `WISE_API_TOKEN`、`HSBC_INGEST_TOKEN` 或任何汇丰账号凭据。

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

应看到两张表。`provider_rate_snapshots` 用于 Wise 与汇丰公开牌价归档；即使该表暂时不可用，页面仍会读取实时接口，只是没有故障降级能力。

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
- 页面反转按钮会同步更新 URL、计算器、三源比较和走势图。

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
- 早于 400 天的数据由 Cron 清理。

## 6. 故障判断

| 现象 | 检查 |
|---|---|
| 三源全部失败 | 检查 Worker 出站网络、构建版本与 `/api/health` |
| Wise 显示归档/暂不可用 | 检查 Worker 日志中的 `Wise public quote unavailable` |
| 汇丰显示归档/暂不可用 | 检查 Worker 日志中的 `HSBC public quote unavailable` |
| 汇丰牌价方向不符 | 确认页面含义是“卖出 BASE、买入 QUOTE”，并核对 `basis` |
| 切换后仍显示旧币种 | 强制刷新页面并确认静态资源版本包含 `live-sources-v2` |
| 没有归档 | 确认 `0002_create_provider_rate_snapshots.sql` 已执行且 Cron 存在 |

## 7. 回滚

代码回滚应通过 Git revert 创建新提交并推送 `main`，由 Cloudflare 自动重新部署。不要删除 D1 表；旧快照与新版本兼容，历史 `hsbc_deposit_plus` 行会被忽略。
