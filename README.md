# FXPulse

FXPulse 是一个面向香港外币用户的多币种汇率比较与换算工具。它覆盖 11 个主要币种，并按同一兑换方向比较公共市场参考价、Wise 公开中间价、汇丰香港官方 TT 牌价，以及 18 家公开发布电汇买卖价的香港零售银行。

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
- Cloudflare Vite Plugin + TypeScript + 原生 DOM
- Vitest

完整产品需求见 [`docs/PRD.md`](docs/PRD.md)，技术设计见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，三源接入见 [`docs/DATA_COLLECTION.md`](docs/DATA_COLLECTION.md)，首次上线、域名配置、验证和回滚见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 已实现能力

- `USD/AUD ↔ AUD/USD` 等任意支持币种对一键反转。
- 双币种金额计算器默认使用公共市场参考价，并可选择 Wise、汇丰或 18 家香港银行的当前可用公开汇率；金额输入不改变下方“1 单位”汇率总览。
- `MARKET OVERVIEW` 的每张币种卡直接展示公共市场、Wise、汇丰公开牌价三项实时数据与价差百分比。
- `MARKET OVERVIEW` 始终把当前目标币种排在左上角第一张；反转币种后顺序、方向和数据同步更新。
- 计算器和总览区都提供带文字的一键反转入口；高对比度配色与放大的汇率数字兼顾桌面端和移动端可读性。
- Wise 公开货币转换器汇率自动接入，无需 Token；每小时 D1 归档。
- 汇丰香港官网匿名牌价接口自动接入；按 TT Buy / TT Sell 与兑换方向计算。
- 汇丰正反方向分别报价，保留银行买卖价差，不把 `AUD/USD` 简单取倒数冒充 `USD/AUD`。
- 香港银行 TT 排行按“客户卖出基准币种、买入目标币种”的同一方向展示 18 家银行；外币交叉盘统一经 HKD 计算。
- 银行缺少某一币种牌价时仍保留该行并标为“暂不可用”，不补造或借用其他银行的数据。
- 历史图表支持 7/15/30/90/365 天、多数据源同时选择、折线图/柱状图切换；柱状图使用颜色叠层而不进行数值相加。
- 公共市场历史可从机构参考价冷启动；Wise、汇丰和香港银行历史只展示 FXPulse 已归档真实快照，数据不足时明确显示“历史积累中”。
- 110 个可索引币种对页面。

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

Cron 已配置为每 15 分钟运行一次（UTC），保存公共市场与 110 个有方向的汇丰公开牌价快照；每小时保存 Wise 的 USD 双向报价，并一次读取 10 个银行币种页、推导并分批归档 18 家银行全部可用方向。用户访问银行对比接口时也会按小时桶补充当前币种对快照。公开来源均不需要 Secret。

## 数据来源

- 当前市场参考价：[ExchangeRate-API](https://www.exchangerate-api.com/)
- 冷启动历史参考价：[Frankfurter](https://frankfurter.dev/)
- Wise 公开中间价：[Wise Currency Converter](https://wise.com/gb/currency-converter/)
- 汇丰香港公开 TT 牌价：[HSBC Currency Exchange Rates](https://www.hsbc.com.hk/investments/products/foreign-exchange/currency-rate/)
- 香港银行公开 TT 牌价聚合：[YoYoRate](https://yoyorate.com/)

## 私有授权

Copyright © 2026 FXPulse. All rights reserved. 本项目不授予开源使用权；任何超出浏览与正常索引范围的代码或数据使用，均须遵守 [`LICENSE`](LICENSE) 并事先取得书面授权。
