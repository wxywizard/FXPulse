# FXPulse 数据采集方案

版本：v1.1<br>
更新时间：2026-08-05

## 1. 采集目标

FXPulse 对同一币种方向并列展示三种口径：

| 来源 | 页面名称 | 比较字段 | 自动化方式 |
|---|---|---|---|
| 公共市场 | 公共市场参考价 | 第三方参考汇率 | Worker 自动获取，每 15 分钟归档 |
| Wise | Wise 中间价 | Wise Rate API 的 `rate` | 官方合作方 API，有凭据时按需获取、每小时归档 |
| 汇丰香港 | Deposit Plus 现货参考价 | 报价返回的 `exchangeSpotRate` | 用户自有设备采集后，通过脱敏导入接口上传 |

三者不可以互相替代。某一来源不可用时，页面显示“待接入”或“需更新”，不使用公共市场价伪装成 Wise 或汇丰报价。

## 2. 统一方向

所有比较统一为：

```text
1 BASE = rate QUOTE
```

例如：

```text
AUD/USD：1 AUD = 0.7044 USD
USD/AUD：1 USD = 1 / 0.7044 = 1.419648 AUD
```

数据库只需保存采集时的原始方向。读取反向币种对时由服务端取倒数，并保留原始采集时间和来源。

## 3. D1 数据模型

公共市场历史继续保存在 `rate_snapshots`。Wise 与汇丰按来源、币种对和采集时间保存在：

```sql
provider_rate_snapshots(
  provider,
  base,
  quote,
  rate,
  rate_type,
  observed_at,
  source_updated_at,
  metadata_json
)
```

应用迁移：

```bash
npm run db:migrate:remote
```

也可以在 Cloudflare D1 Console 执行 [`migrations/0002_create_provider_rate_snapshots.sql`](../migrations/0002_create_provider_rate_snapshots.sql)。

## 4. 公共市场参考价

- 当前适配器：ExchangeRate-API 开放端点。
- 页面和 Cron 都读取同一份 USD 基准快照，再计算交叉汇率；每 15 分钟检查并归档。
- 正向和反向币种对来自同一快照，避免提供方不同基准请求造成舍入偏差。
- 注意：开放端点通常不是逐笔实时价，页面只称“公共市场参考价”。
- 历史冷启动：Frankfurter 日频机构参考数据。

该来源是三源差异百分比的计算基准：

```text
差异百分比 = (来源汇率 - 公共市场汇率) / 公共市场汇率 × 100%
```

## 5. Wise 官方数据

FXPulse 使用 Wise 官方 Rate API：

```http
GET https://api.wise.com/v1/rates?source=AUD&target=USD
Authorization: Bearer <WISE_API_TOKEN>
```

Wise 官方文档明确要求 Bearer 或 Affiliate Basic Authentication。生产环境应申请 Wise Platform/Affiliate 合作方凭据，不要把个人 Wise 账户的高权限 Token 直接放入公共项目。

Cloudflare Secret 名称：

```text
WISE_API_TOKEN
```

CLI 配置：

```bash
npx wrangler secret put WISE_API_TOKEN
```

Dashboard 配置：

```text
Workers & Pages → fxpulse → Settings → Variables and Secrets
→ Add → Secret → WISE_API_TOKEN
```

行为：

- 用户打开币种对时，`/api/compare` 按需获取该 Wise 报价。
- 每小时整点采集 10 个 `USD → 目标币种` 报价，作为故障降级归档。
- Wise 临时不可用时优先返回最近归档，并标记“需更新”。
- 未配置凭据时显示“待接入”，不会调用非公开网页接口或抓取 Wise 页面。

官方参考：[Wise Rate API](https://docs.wise.com/api-reference/rate/rateget)、[Wise Affiliate live rates](https://docs.wise.com/guides/product/send-money/use-cases/affiliates)

## 6. 汇丰 Deposit Plus 数据

登录后的产品报价服务为：

```http
POST https://investments3.personal-banking.hsbc.com.hk/shp/wealth-mobile-sifi-shp-api-hk-hbap-prod-proxy/v0/aws/sp/dcd/quote
```

该接口依赖客户登录会话（例如 `dspSession`），不属于适合公共 Worker 长期匿名调用的公开 API。FXPulse 不保存、转发或刷新汇丰登录会话，也不自动登录用户账户。

### 6.1 安全导入通道

先生成一个只用于 FXPulse 采集的独立随机 Token：

```bash
openssl rand -hex 32
```

把结果保存为 Cloudflare Secret：

```bash
npx wrangler secret put HSBC_INGEST_TOKEN
```

或在 Dashboard 中添加 Secret：

```text
HSBC_INGEST_TOKEN
```

导入接口：

```http
POST /api/ingest/hsbc
Authorization: Bearer <HSBC_INGEST_TOKEN>
Content-Type: application/json
```

AUD/USD 示例：

```bash
curl -X POST "https://fxpulse.177.best/api/ingest/hsbc" \
  -H "Authorization: Bearer <HSBC_INGEST_TOKEN>" \
  -H "Content-Type: application/json" \
  --data '{
    "base": "AUD",
    "quote": "USD",
    "exchangeSpotRate": 0.7044,
    "capturedAt": "2026-08-05T12:30:00+08:00",
    "conversionRate": 0.7010,
    "interestRate": 6.5,
    "depositPeriod": "1W",
    "currencyPairSymbolText": "AUD/USD"
  }'
```

服务端只允许保存以下白名单字段：

- `base`
- `quote`
- `exchangeSpotRate`
- `capturedAt`
- `exchangeBreakEvenRate`
- `conversionRate`
- `interestRate`
- `depositPeriod`
- `currencyPairSymbolText`

即使请求中误带 `dspSession`、Cookie、账户号或其他字段，也会被丢弃。更安全的做法仍然是在本地先删除所有会话头和账户数据，只上传白名单 JSON。

### 6.2 后续本地采集器

下一阶段可在用户自有 Mac 上运行本地采集器：

1. 用户自行登录汇丰官方 App/网站。
2. 本地代理仅识别 `/aws/sp/dcd/quote` 的返回。
3. 在本机提取白名单字段并立即删除原始响应。
4. 使用独立 `HSBC_INGEST_TOKEN` 上传到 FXPulse。
5. 不上传请求头、Cookie、`dspSession`、账户资料或完整交易响应。

该采集器必须是用户主动运行的本地工具，不能在 Cloudflare Worker 中模拟客户登录。

## 7. 报价状态与保留策略

| 状态 | 规则 | 页面表现 |
|---|---|---|
| 可用 | Wise/汇丰更新时间不超过 15 分钟 | 绿色“可用” |
| 需更新 | 有归档，但更新时间超过 15 分钟 | 黄色“需更新”，仍显示时间 |
| 待接入 | 没有凭据、没有导入或没有归档 | 不展示数字，说明原因 |

- 所有来源保留原始 `source_updated_at`，不使用页面访问时间冒充报价时间。
- 快照保留 400 天，Cron 自动清理更早数据。
- 公共市场、Wise 和汇丰错误分别记录，不因单一来源失败而伪造其他来源。

## 8. 验证

查看三源比较：

```bash
curl "https://fxpulse.177.best/api/compare?base=AUD&quote=USD"
```

检查最新归档：

```sql
SELECT provider, base, quote, rate,
       datetime(source_updated_at, 'unixepoch') AS source_updated_utc
FROM provider_rate_snapshots
ORDER BY source_updated_at DESC
LIMIT 20;
```

页面方向反转验证：

```text
https://fxpulse.177.best/rates/aud/usd
https://fxpulse.177.best/rates/usd/aud
```

两页汇率应互为倒数，来源和采集时间应一致。
