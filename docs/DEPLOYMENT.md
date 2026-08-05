# FXPulse 部署文档

本文档用于将 FXPulse 部署到 Cloudflare。项目采用单个 Cloudflare Worker 承载服务端页面、API 和静态资源，使用 D1 保存汇率快照，并通过 Cron Trigger 每 15 分钟采集一次数据。

## 1. 部署清单

| 项目 | 当前配置 |
|---|---|
| Worker 名称 | `fxpulse` |
| 运行时 | Cloudflare Workers |
| 静态资源 | Workers Static Assets，绑定名 `ASSETS` |
| D1 数据库 | `fxpulse-db`，绑定名 `DB` |
| D1 迁移目录 | `migrations/` |
| 定时任务 | `*/15 * * * *`，按 UTC 执行 |
| Node.js | 22 或更高版本 |
| 生产密钥 | `WISE_API_TOKEN`（可选）、`HSBC_INGEST_TOKEN`（启用汇丰导入时必需） |
| 当前价来源 | ExchangeRate-API、Wise 官方 Rate API、汇丰安全导入 |
| 历史价来源 | D1 优先，Frankfurter 冷启动降级 |

首次部署必须完成以下四项：

1. 创建 D1 数据库。
2. 将真实 `database_id` 写入 `wrangler.jsonc`。
3. 执行远端数据库迁移（包含公共市场与多来源报价表）。
4. 部署 Worker并按需配置 Wise/汇丰 Secrets。
5. 验证 Cron、三源比较和汇丰安全导入。

## 2. 前置条件

- 已有 Cloudflare 账户，并具有 Workers 与 D1 的创建和部署权限。
- 本机已安装 Git、Node.js 22+ 和 npm。
- 如使用自定义域名，该域名所在 Zone 已接入当前 Cloudflare 账户。
- 已克隆项目仓库：<https://github.com/wxywizard/FXPulse>。

检查本机版本：

```bash
node --version
npm --version
git --version
```

项目已经锁定依赖版本，部署时应使用 `npm ci`，不要使用会改写锁文件的安装方式。

## 3. 首次部署

### 3.1 获取代码并安装依赖

```bash
git clone https://github.com/wxywizard/FXPulse.git
cd FXPulse
npm ci
```

如果已经克隆仓库：

```bash
git pull --ff-only
npm ci
```

### 3.2 登录 Cloudflare

本地交互式部署使用 Wrangler OAuth：

```bash
npx wrangler login
npx wrangler whoami
```

`whoami` 输出的账户必须是准备承载 FXPulse 的 Cloudflare 账户。

不要把 Global API Key、API Token 或其他凭据写入仓库、`wrangler.jsonc` 或提交记录。

### 3.3 部署前验证

```bash
npm run check
```

该命令会依次执行：

- TypeScript 类型检查；
- Vitest 单元测试；
- Cloudflare Vite 生产构建。

只有全部通过后再继续生产部署。

### 3.4 创建 D1 数据库

```bash
npx wrangler d1 create fxpulse-db
```

命令会返回真实的数据库 ID。项目已经包含完整的 D1 绑定配置，因此只需要把 `wrangler.jsonc` 中的占位值：

```json
"database_id": "00000000-0000-0000-0000-000000000000"
```

替换为刚创建的 ID。保留以下两个名称不变：

```json
"binding": "DB",
"database_name": "fxpulse-db"
```

不要在 `d1_databases` 中重复增加第二个 `DB` 绑定。

### 3.5 执行生产数据库迁移

```bash
npm run db:migrate:remote
```

确认迁移状态：

```bash
npx wrangler d1 migrations list fxpulse-db --remote
```

确认数据表已经创建：

```bash
npx wrangler d1 execute fxpulse-db --remote \
  --command "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('rate_snapshots', 'provider_rate_snapshots');"
```

输出中应包含 `rate_snapshots` 和 `provider_rate_snapshots`。

> `npm run db:migrate:local` 只操作本地开发数据库，不能替代带 `--remote` 的生产迁移。

### 3.6 部署 Worker

```bash
npm run deploy
```

该脚本先运行生产构建，再执行 `wrangler deploy`。成功后 Wrangler 会输出类似下面的访问地址：

```text
https://fxpulse.<your-subdomain>.workers.dev
```

`wrangler.jsonc` 中已经声明 D1、静态资源、Cron 和可观测性配置，部署时会一并应用。

### 3.7 配置可选数据源 Secrets

Wise 官方报价需要合作方 API Token：

```bash
npx wrangler secret put WISE_API_TOKEN
```

汇丰脱敏导入需要独立的随机 Token：

```bash
openssl rand -hex 32
npx wrangler secret put HSBC_INGEST_TOKEN
```

如果使用 Cloudflare Dashboard：

```text
Workers & Pages → fxpulse → Settings → Variables and Secrets → Add → Secret
```

不要把 Token 填为普通明文 Variable，也不要写入 `wrangler.jsonc`、GitHub 代码或构建日志。未配置 Wise Token 时网站仍可正常运行，但 Wise 列会显示“待接入”；未配置汇丰导入 Token 时该列等待采集。

## 4. 上线验证

把下列命令中的 `<ORIGIN>` 替换为实际 Worker 地址或生产域名，例如 `https://fxpulse.example.com`。

### 4.1 健康检查

```bash
curl -fsS "<ORIGIN>/api/health"
```

期望返回：

```json
{"status":"ok","service":"fxpulse","time":"..."}
```

### 4.2 当前汇率

```bash
curl -fsS "<ORIGIN>/api/rates?base=HKD"
```

应返回 11 个支持币种的市场参考价，并包含 `provider`、`sourceUpdatedAt` 和 `fetchedAt`。

### 4.3 历史汇率

```bash
curl -fsS "<ORIGIN>/api/history?base=HKD&quote=USD&days=30"
```

首次上线时 D1 快照不足，接口会自动使用 Frankfurter 日频历史数据；这属于正常冷启动行为。D1 累积至少 4 个完整时间点后，会优先返回 FXPulse 自有快照。

### 4.4 三源报价

```bash
curl -fsS "<ORIGIN>/api/compare?base=AUD&quote=USD"
```

响应应包含 `market`、`wise`、`hsbc_deposit_plus` 三个来源。尚未配置/采集的来源必须返回 `status: unavailable` 和 `rate: null`，不能复制公共市场价。

### 4.5 页面、SEO 与 GEO 文件

逐项访问：

```text
<ORIGIN>/
<ORIGIN>/rates/hkd/usd
<ORIGIN>/sitemap.xml
<ORIGIN>/robots.txt
<ORIGIN>/llms.txt
```

检查标准：

- 首页和币种对页面可以正常打开；
- `USD/AUD ↔ AUD/USD` 一键反转可用，URL 和所有报价方向同步更新；
- 金额计算器可用，金额输入不改变下方按 1 单位展示的汇率；
- 三源对比和 7/15/30/90/365 天走势图可用；
- `sitemap.xml` 中的 URL 使用最终生产域名；
- `robots.txt` 指向同域名的 Sitemap；
- `llms.txt` 可以直接访问。

## 5. 验证 Cron 和 D1 快照

生产 Cron 表达式为：

```text
*/15 * * * *
```

Cloudflare Cron 统一按 UTC 执行。新增或修改 Cron 后，全球生效最多可能需要约 15 分钟。

### 5.1 查看 Cron 执行记录

在 Cloudflare Dashboard 进入：

```text
Workers & Pages → fxpulse → Settings → Trigger Events → View events
```

也可以查看实时日志：

```bash
npx wrangler tail
```

成功采集时日志中会出现 `Stored FX snapshot`。

### 5.2 查询生产快照

等待至少一次 Cron 后执行：

```bash
npx wrangler d1 execute fxpulse-db --remote \
  --command "SELECT COUNT(*) AS rows, datetime(MAX(observed_at), 'unixepoch') AS latest_utc FROM rate_snapshots;"
```

首次成功采集会写入 11 行公共市场数据。`latest_utc` 应接近最近一个 Cron 执行时间。配置 Wise Token 后，每小时整点还会向 `provider_rate_snapshots` 写入最多 10 条 USD 基准 Wise 快照。

检查多来源归档：

```bash
npx wrangler d1 execute fxpulse-db --remote \
  --command "SELECT provider, COUNT(*) AS rows, datetime(MAX(source_updated_at), 'unixepoch') AS latest_utc FROM provider_rate_snapshots GROUP BY provider;"
```

### 5.3 本地触发 scheduled handler

先启动本地环境：

```bash
npm run db:migrate:local
npm run dev
```

Cloudflare Vite Plugin 默认使用 5173 端口；以终端实际输出端口为准：

```bash
curl "http://localhost:5173/cdn-cgi/handler/scheduled?format=json"
```

期望返回 `outcome: ok`。本地触发只写入本地 D1，不会修改生产数据库。

## 6. 配置自定义域名

建议只保留一个可被搜索引擎索引的生产主域名，避免同一页面同时通过 `workers.dev`、根域名和 `www` 域名访问而形成重复内容。

### 6.1 推荐：通过 Wrangler 配置

将实际域名写入 `wrangler.jsonc`：

```jsonc
{
  "workers_dev": false,
  "routes": [
    {
      "pattern": "fxpulse.example.com",
      "custom_domain": true
    }
  ]
}
```

然后重新部署：

```bash
npm run deploy
```

`pattern` 只填写主机名，不要包含 `https://`、路径或通配符。Cloudflare 会为 Custom Domain 创建 DNS 记录并签发证书。

### 6.2 通过 Dashboard 配置

也可以进入：

```text
Workers & Pages → fxpulse → Settings → Domains & Routes → Add → Custom Domain
```

如果后续仍使用 Wrangler 管理项目，建议最终把域名配置同步回 `wrangler.jsonc`，让生产配置可以被版本控制和复现。

### 6.3 域名上线后的 SEO/GEO 操作

1. 再次完成第 4 节全部验证，确认 Sitemap 和 canonical URL 都使用正式域名。
2. 将 `<ORIGIN>/sitemap.xml` 提交到 Google Search Console 和 Bing Webmaster Tools。
3. 确保只有主域名对外提供 200 响应；其他域名应 301/308 跳转至主域名。
4. 保持 `<ORIGIN>/llms.txt` 可公开访问。

## 7. 日常发布流程

后续发布统一使用：

```bash
git pull --ff-only
npm ci
npm run check
npm run db:migrate:remote
npm run deploy
```

没有新增迁移时，`db:migrate:remote` 会提示没有迁移需要执行，可以安全保留在发布流程中。

发布后至少验证：

```bash
curl -fsS "<ORIGIN>/api/health"
curl -fsS "<ORIGIN>/api/rates?base=HKD"
npx wrangler deployments status
```

### 静态资源缓存注意事项

当前 `app.js` 和 `styles.css` 使用固定文件名，且在 `public/_headers` 中配置了长期 `immutable` 浏览器缓存。首次上线不受影响；以后修改这两个文件时，必须采用以下任一方案，避免老用户继续使用浏览器缓存中的旧版本：

- 为资源文件名增加内容哈希并同步更新 HTML 引用；或
- 调整 `_headers`，不要对未带版本号的文件使用一年期 `immutable` 缓存。

Cloudflare 边缘缓存刷新不能强制清除已经进入用户浏览器的 `immutable` 缓存。

## 8. CI/CD 说明

当前 `.github/workflows/ci.yml` 只执行 `npm ci` 和 `npm run check`，不会自动部署生产环境。这是有意的安全边界：在 D1 ID、生产域名和 Cloudflare 权限未固定之前，部署仍由人工执行。

如果后续启用 GitHub Actions 自动部署，需要在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 中增加：

| Secret | 用途 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
| `CLOUDFLARE_API_TOKEN` | 限定当前账户和 Worker/D1 权限的 API Token |

Token 只能存放在 GitHub Actions Secrets 中，不能写入代码或配置文件。自动化发布还必须处理 D1 迁移顺序：先验证、再迁移、最后部署 Worker。

也可以使用 Cloudflare Workers Builds 直接连接 GitHub 仓库。无论选择哪种自动化方式，建议先完整完成一次人工部署和回滚演练。

## 9. 日志与监控

实时查看 Worker 请求、异常和 Cron 日志：

```bash
npx wrangler tail
```

Dashboard 路径：

```text
Workers & Pages → fxpulse → Logs
```

建议重点关注：

- `/api/rates` 的 5xx 响应；
- `/api/compare` 中 Wise/汇丰的 `unavailable` 或 `stale` 状态；
- `/api/ingest/hsbc` 的 401/400 异常增长；
- `/api/history` 的 5xx 响应和 D1 降级日志；
- Cron 是否连续失败；
- D1 中 `MAX(observed_at)` 是否持续更新；
- ExchangeRate-API 或 Frankfurter 的上游错误。

当前代码在上游不可用时会返回明确的 503，不会生成随机或伪造汇率。

## 10. 回滚

### 10.1 回滚 Worker 代码

查看最近部署：

```bash
npx wrangler deployments list
```

回滚到指定版本：

```bash
npx wrangler rollback <VERSION_ID> --message "Rollback FXPulse production"
```

不传 `VERSION_ID` 时，Wrangler 默认回滚到最新版本之前的版本：

```bash
npx wrangler rollback
```

回滚后重新执行第 4 节的健康、行情和页面验证。

### 10.2 D1 数据回滚

Worker 代码回滚不会自动回滚 D1。只有确认数据库发生错误写入或破坏性迁移时，才考虑 D1 Time Travel。

先查询目标时间对应的恢复点：

```bash
npx wrangler d1 time-travel info fxpulse-db \
  --timestamp "2026-08-04T00:00:00Z"
```

恢复命令会原地覆盖生产数据库，属于破坏性操作：

```bash
npx wrangler d1 time-travel restore fxpulse-db \
  --timestamp "2026-08-04T00:00:00Z"
```

执行恢复前必须核对数据库名称、UTC 时间和 Wrangler 显示的恢复点；不要直接复制示例时间执行。D1 Time Travel 的可恢复窗口取决于 Cloudflare 套餐，Free 计划通常为 7 天，Paid 计划通常为 30 天。

## 11. 常见问题

| 现象 | 检查与处理 |
|---|---|
| 部署时找不到 D1 | 确认 `database_id` 已替换、数据库属于当前 `wrangler whoami` 账户、绑定名仍为 `DB`。 |
| 迁移成功但生产表不存在 | 确认命令带有 `--remote`，并检查是否误操作了本地 D1。 |
| 首页正常但当前价返回 503 | 使用 `wrangler tail` 查看上游请求错误；当前价来自 ExchangeRate-API 公共接口。 |
| Wise 一直显示待接入 | 确认 `WISE_API_TOKEN` 是 Secret、来自 Wise 官方合作方能力，并在修改 Secret 后重新部署/重试。 |
| 汇丰一直显示待接入 | 确认已创建 `provider_rate_snapshots`、设置 `HSBC_INGEST_TOKEN`，并成功导入对应币种对。 |
| 汇丰导入返回 401 | `Authorization` 必须使用 `Bearer <HSBC_INGEST_TOKEN>`，不能使用汇丰 `dspSession`。 |
| 历史接口显示日频数据 | D1 冷启动或快照不足 4 个时间点时会使用 Frankfurter，属于预期降级。 |
| Cron 上线后没有立即执行 | 新增或修改 Cron 最多可能需要约 15 分钟传播，随后检查 Trigger Events、日志和 D1。 |
| 自定义域名打不开 | 确认域名 Zone 在同一 Cloudflare 账户、Custom Domain 状态正常、证书已签发。 |
| 发布后仍看到旧 UI | 检查浏览器是否命中 `app.js`/`styles.css` 的长期 immutable 缓存，并按第 7 节处理资源版本。 |

## 12. 官方参考

- [Cloudflare D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare D1 Wrangler Commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare Workers Real-time Logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/)
- [Cloudflare Worker Rollback](https://developers.cloudflare.com/workers/wrangler/commands/workers/#rollback)
- [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Cloudflare Workers GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
