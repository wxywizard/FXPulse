# FXPulse

FXPulse 是一个面向汇丰香港外币与 Deposit Plus 关注者的多币种汇率观察工具。它覆盖 11 个主要币种，并按同一兑换方向比较公共市场参考价、Wise 公开中间价与汇丰香港公开 TT 牌价。

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
- `MARKET OVERVIEW` 的每张币种卡直接展示公共市场、Wise、汇丰公开牌价三项实时数据与价差百分比。
- 计算器和总览区都提供带文字的一键反转入口；高对比度配色与放大的汇率数字兼顾桌面端和移动端可读性。
- Wise 公开货币转换器汇率自动接入，无需 Token；每小时 D1 归档。
- 汇丰香港官网匿名牌价接口自动接入；按 TT Buy / TT Sell 与兑换方向计算。
- 汇丰正反方向分别报价，保留银行买卖价差，不把 `AUD/USD` 简单取倒数冒充 `USD/AUD`。
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

Cron 已配置为每 15 分钟运行一次（UTC），保存公共市场与 110 个有方向的汇丰公开牌价快照；Wise 每小时保存 USD 与其余币种的双向快照。三项公开来源都不需要 Secret。

## 数据来源

- 当前市场参考价：[ExchangeRate-API](https://www.exchangerate-api.com/)
- 冷启动历史参考价：[Frankfurter](https://frankfurter.dev/)
- Wise 公开中间价：[Wise Currency Converter](https://wise.com/gb/currency-converter/)
- 汇丰香港公开 TT 牌价：[HSBC Currency Exchange Rates](https://www.hsbc.com.hk/investments/products/foreign-exchange/currency-rate/)
- 产品风险说明：[HSBC Hong Kong Deposit Plus](https://www.hsbc.com.hk/investments/products/structured/deposit-plus/)

## License

See [LICENSE](LICENSE).
