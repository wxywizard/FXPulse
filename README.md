# FXPulse

FXPulse 是一个面向汇丰香港 Deposit Plus 关注者的多币种汇率观察工具。它覆盖产品当前支持的 11 个币种，并按同一方向比较公共市场参考价、Wise 中间价与汇丰 Deposit Plus 现货参考价。

> FXPulse 不是汇丰网站，也不提供银行报价或投资建议。实际交易请以汇丰香港官方渠道和产品文件为准。

## 技术栈

- Cloudflare Workers + Static Assets
- Cloudflare D1
- Cloudflare Cron Triggers
- Cloudflare Vite Plugin + TypeScript + 原生 DOM
- Vitest

完整产品需求见 [`docs/PRD.md`](docs/PRD.md)，技术设计见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，三源接入见 [`docs/DATA_COLLECTION.md`](docs/DATA_COLLECTION.md)，首次上线、域名配置、验证和回滚见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 已实现能力

- `USD/AUD ↔ AUD/USD` 等任意支持币种对一键反转。
- Wise 风格的双币种金额计算器；金额输入不改变下方“1 单位”汇率总览。
- 公共市场、Wise、汇丰 Deposit Plus 三源对比与价差百分比。
- Wise 官方 Rate API 可选接入，以及每小时 D1 归档。
- 汇丰 App 报价的安全脱敏导入；不保存登录会话、Cookie 或账户资料。
- 7/15/30/90/365 天历史走势与 110 个可索引币种对页面。

## 本地开发

```bash
npm install
npm run db:migrate:local
npm run dev
```

访问 Vite 输出的本地地址。Cloudflare Vite Plugin 会让 Worker 代码运行在与生产环境一致的 Workers runtime 中。

## 验证

```bash
npm run check
```

该命令依次执行 TypeScript 类型检查、单元测试和 Cloudflare Worker dry-run 构建。

## 部署到 Cloudflare

完整操作请参考 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

先创建 D1 数据库：

```bash
npx wrangler d1 create fxpulse-db
```

将返回的 `database_id` 替换到 `wrangler.jsonc`，然后执行：

```bash
npm run db:migrate:remote
npm run deploy
```

Cron 已配置为每 15 分钟运行一次（UTC），定时保存 11 个币种相对 USD 的公共市场参考价快照；配置 Wise 官方凭据后，每小时保存一次 Wise 快照。

## 数据来源

- 当前市场参考价：[ExchangeRate-API](https://www.exchangerate-api.com/)
- 冷启动历史参考价：[Frankfurter](https://frankfurter.dev/)
- Wise 中间价（需官方凭据）：[Wise Rate API](https://docs.wise.com/api-reference/rate/rateget)
- 支持币种与产品风险说明：[HSBC Hong Kong Deposit Plus](https://www.hsbc.com.hk/investments/products/structured/deposit-plus/)

## License

See [LICENSE](LICENSE).
