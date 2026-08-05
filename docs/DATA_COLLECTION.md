# FXPulse 数据采集方案

版本：v1.2<br>
更新时间：2026-08-05

## 1. 三项数据口径

| 来源 | 页面名称 | 当前价获取方式 | 归档频率 |
|---|---|---|---|
| 公共市场 | 公共市场参考价 | ExchangeRate-API 的 USD 锚定公开快照 | 每 15 分钟 |
| Wise | Wise 公开中间价 | `wise.com/rates/live` 当前币种对 | 每小时保存 USD 双向报价 |
| 汇丰香港 | 汇丰公开牌价（TT） | 香港官网公开 `exchange-rate` JSON 中的 TT Buy / TT Sell | 每 15 分钟保存 110 个有向币种对 |

三项来源均自动采集，不需要账号、Token、Cookie 或用户手工导入。任一来源失败时只回退到它自己的 D1 归档，不允许用另一项汇率冒充。

## 2. 公共市场参考价

Worker 固定读取同一份 USD 基准数据，再计算交叉汇率：

```text
rate(BASE → QUOTE) = USD→QUOTE / USD→BASE
```

同一快照下的 `USD/AUD` 与 `AUD/USD` 严格互为倒数。该数据是市场参考价，不是银行成交价。

## 3. Wise 公开中间价

请求示例：

```http
GET https://wise.com/rates/live?source=AUD&target=USD
Accept: application/json
```

响应示例：

```json
{
  "source": "AUD",
  "target": "USD",
  "value": 0.70435,
  "time": 1785914423771
}
```

页面访问时按当前方向请求。该接口来自 Wise 公开货币转换器，属于公开网页能力而非带 SLA 的 Wise Platform 合作方 API，因此必须保留来源时间和失败降级状态。

## 4. 汇丰香港公开牌价

公开牌价接口：

```http
GET https://rbwm-api.hsbc.com.hk/digital-pws-tools-investments-eapi-prod-proxy/v1/investments/exchange-rate?locale=zh_HK
Accept: application/json
```

每个外币返回：

- `ttBuyRt`：汇丰买入该外币、向客户支付的 HKD 牌价；
- `ttSelRt`：汇丰卖出该外币、向客户收取的 HKD 牌价；
- `lastUpdateDate`：汇丰原始更新时间；
- `ccy`：币种代码。

FXPulse 的方向语义始终是“客户卖出 BASE，买入 QUOTE”：

```text
BASE 外币 → HKD：BASE.ttBuyRt
HKD → QUOTE 外币：1 / QUOTE.ttSelRt
BASE 外币 → QUOTE 外币：BASE.ttBuyRt / QUOTE.ttSelRt
```

以接口中的示例牌价说明：

```text
USD TT Buy = 7.81110 HKD
USD TT Sell = 7.87570 HKD
AUD TT Buy = 5.48660 HKD
AUD TT Sell = 5.56470 HKD

USD/AUD = 7.81110 / 5.56470
AUD/USD = 5.48660 / 7.87570
```

两个方向不会互为倒数，这是银行买卖价差的结果，不是计算错误。

## 5. 与 Deposit Plus 的边界

汇丰公开牌价可匿名、自动、稳定地用于比较，但它不等于：

- Deposit Plus 登录后的 `exchangeSpotRate`；
- `conversionRate` 或盈亏平衡汇率；
- 具体金额、期限、客户等级对应的产品利率；
- 保证成交价或投资回报。

FXPulse 页面必须明确标注“汇丰公开牌价（TT）”。在没有授权产品报价前，不再展示空白的“Deposit Plus 实时价”卡片，也不使用公共市场价冒充。

## 6. D1 与降级

`provider_rate_snapshots` 保存来源、方向、报价类型、采集时间、来源更新时间和计算口径。读取规则：

- Wise：优先同方向归档；必要时可读取反方向并取倒数；
- 汇丰：只能读取完全相同方向的归档，禁止取倒数；
- 实时请求成功显示“实时”；
- 实时请求失败但有归档显示“归档”；
- 两者都没有显示“暂不可用”。

## 7. 验证

```bash
curl "https://fxpulse.177.best/api/compare?base=USD&quote=AUD"
curl "https://fxpulse.177.best/api/compare?base=AUD&quote=USD"
```

验收要点：

- 两个响应均包含 `market`、`wise`、`hsbc_public`；
- Wise 与汇丰无需配置 Secret 即可返回数字；
- 汇丰返回 `basis`，说明使用的 TT 计算口径；
- 反转页面、计算器、三源对比、走势图和 canonical URL 同步切换。
