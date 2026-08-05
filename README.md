# FXPulse

FXPulse 是一个面向香港外币用户的多币种汇率比较与换算工具。它覆盖 11 个主要币种，并按同一兑换方向比较公共市场参考价、Wise 公开中间价，以及当前可从匿名公开来源取得同口径 TT 买卖价的 18 家香港零售银行；其中汇丰一行由香港官网匿名接口校准。

> FXPulse 是独立信息工具，与页面所列银行及 Wise 没有隶属、代理或合作关系。公开汇率均为指示性数据，实际交易以相应服务提供方最终确认页面为准。

## 数据使用与私有授权（必须阅读）

本仓库为**源代码可见项目，并非开源软件**。除浏览网站和正常搜索引擎索引外，任何人或组织在使用、抓取、复制、镜像、转载、分发、转售、商业化本站数据、API、整理结果或源代码前，均必须取得 FXPulse 权利方的书面授权；未经授权使用将被视为侵权。

即使已取得授权，使用 FXPulse 数据或整理结果时仍必须同时满足以下署名要求：

- 在使用位置显著标注“数据来自 FXPulse”；
- 提供指向本项目公开仓库的可点击链接：[https://github.com/wxywizard/FXPulse](https://github.com/wxywizard/FXPulse)；
- 不得以任何方式暗示 FXPulse、银行或数据提供方为使用者背书。

完整条款见 [`LICENSE`](LICENSE)。当前代码、数据整理结果及页面内容均保留全部权利。

## 技术栈

- Cloudflare Workers + Static Assets
- Cloudflare D1
- Cloudflare Cron Triggers
- Cloudflare Workers Cache API
- Cloudflare Vite Plugin + TypeScript + 原生 DOM
- Vitest

完整产品需求见 [`docs/PRD.md`](docs/PRD.md)，技术设计见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，数据源接入见 [`docs/DATA_COLLECTION.md`](docs/DATA_COLLECTION.md)，首次上线、域名配置、验证和回滚见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 已实现能力

- `USD/AUD ↔ AUD/USD` 等任意支持币种对一键反转。
- 双币种金额计算器默认使用公共市场参考价，并可选择 Wise、汇丰或其他已接入香港银行的当前可用公开汇率；金额输入不改变下方“1 单位”汇率总览。
- 公共市场、Wise 与香港银行报价合并在同一张“汇率来源对比”表中，不再设置割裂的顶部三源卡片。
- `MARKET OVERVIEW` 固定展示公共市场和 Wise；全局可再选择任意最多 5 个已接入来源，每张币种卡可沿用全局配置或保存自己的最多 5 个来源。
- `MARKET OVERVIEW` 始终把当前目标币种排在左上角第一张；反转币种后顺序、方向和数据同步更新。
- 计算器和总览区都提供带文字的一键反转入口；高对比度配色与放大的汇率数字兼顾桌面端和移动端可读性。
- Wise 公开货币转换器汇率自动接入，无需 Token；每小时 D1 归档。
- 汇丰香港官网匿名牌价接口自动接入；按 TT Buy / TT Sell 与兑换方向计算。
- 汇丰正反方向分别报价，保留银行买卖价差，不把 `AUD/USD` 简单取倒数冒充 `USD/AUD`。
- 香港银行 TT 排行按“客户卖出基准币种、买入目标币种”的同一方向展示 18 家银行；外币交叉盘统一经 HKD 计算。
- 银行缺少某一币种牌价时仍保留该行并标为“暂不可用”，不补造或借用其他银行的数据。
- 历史图表支持 7/15/30/90/365 天、折线图/柱状图切换；公共市场和 Wise 固定保留，另可选择最多 5 个已接入来源。柱状图按香港日期为所有来源共用一个柱位，以高对比色和嵌套柱宽叠层区分且不进行数值相加。
- 公共市场历史可从机构参考价冷启动；Wise、汇丰和香港银行历史只展示 FXPulse 已归档真实快照，数据不足时明确显示“历史积累中”。
- 110 个可索引币种对页面。

## 数据源准入边界

- 可配置来源必须能从无需登录的官方接口或可靠第三方公开数据源自动取得，不能要求用户提供账号、Cookie、Token 或 App 会话。
- 渣打及香港数字银行目前没有找到满足上述条件、且可持续取得同口径实时客户汇率的第三方来源，因此暂不接入，也不显示空配置项。
- 宣传页静态示例、登录后 App 报价、市场中间价或其他银行数据均不能代替缺失的银行客户牌价；后续只有在找到可核验的匿名第三方实时源后才增加来源。

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

Cron 已配置为每小时运行一次（UTC）。公共市场按来源更新时间去重；汇丰 110 个有向牌价与 Wise 的 USD 双向报价每小时归档；18 家银行只在 UTC 00:00、08:00、16:00 读取 10 个币种页并归档全部可用方向。页面 API 只读 D1，不因访问量产生额外写入。盘中数据保留 30 天并生成日均点，日线保留 400 天；所有公开 API 使用 Workers Cache API 提供新鲜缓存和旧数据回退。公开来源均不需要 Secret。

## 数据来源

- 当前市场参考价：[ExchangeRate-API](https://www.exchangerate-api.com/)
- 冷启动历史参考价：[Frankfurter](https://frankfurter.dev/)
- Wise 公开中间价：[Wise Currency Converter](https://wise.com/gb/currency-converter/)
- 汇丰香港公开 TT 牌价：[HSBC Currency Exchange Rates](https://www.hsbc.com.hk/investments/products/foreign-exchange/currency-rate/)
- 香港银行公开 TT 牌价聚合：[YoYoRate](https://yoyorate.com/)

## 私有授权

Copyright © 2026 FXPulse. All rights reserved. 本项目不授予开源使用权；任何超出浏览与正常索引范围的代码或数据使用，均须遵守 [`LICENSE`](LICENSE) 并事先取得书面授权。
