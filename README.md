# FXPulse

FXPulse 是一个面向汇丰香港 Deposit Plus 关注者的多币种汇率观察工具。它覆盖产品当前支持的 11 个币种，提供当前市场参考价、金额换算和 7/15/30/90/365 天走势。

> FXPulse 不是汇丰网站，也不提供银行报价或投资建议。实际交易请以汇丰香港官方渠道和产品文件为准。

## 技术栈

- Cloudflare Workers + Static Assets
- Cloudflare D1
- Cloudflare Cron Triggers
- Cloudflare Vite Plugin + TypeScript + 原生 DOM
- Vitest

完整产品需求见 [`docs/PRD.md`](docs/PRD.md)，技术设计见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

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

先创建 D1 数据库：

```bash
npx wrangler d1 create fxpulse-db
```

将返回的 `database_id` 替换到 `wrangler.jsonc`，然后执行：

```bash
npm run db:migrate:remote
npm run deploy
```

Cron 已配置为每 15 分钟运行一次（UTC），定时保存 11 个币种相对 USD 的参考价快照。

## 数据来源

- 当前市场参考价：[ExchangeRate-API](https://www.exchangerate-api.com/)
- 冷启动历史参考价：[Frankfurter](https://frankfurter.dev/)
- 支持币种与产品风险说明：[HSBC Hong Kong Deposit Plus](https://www.hsbc.com.hk/investments/products/structured/deposit-plus/)

## License

See [LICENSE](LICENSE).
