# FXPulse 数据采集方案

版本：v1.6<br>
更新时间：2026-08-05

## 1. 数据口径

| 来源 | 页面名称 | 当前价获取方式 | 归档频率 |
|---|---|---|---|
| 公共市场 | 公共市场参考价 | ExchangeRate-API 的 USD 锚定公开快照 | 每小时检查，仅来源更新时间变化时新增 |
| Wise | Wise 公开中间价 | `wise.com/rates/live` 当前币种对 | 每小时保存 USD 双向报价 |
| 汇丰香港 | 汇丰公开牌价（TT） | 香港官网公开 `exchange-rate` JSON 中的 TT Buy / TT Sell | 每小时保存 110 个有向币种对 |
| 18 家香港银行 | 香港银行 TT 排行 | YoYoRate 公开聚合页中的 TT Buy / TT Sell；汇丰行由官网接口校准 | 每 8 小时全方向归档；页面按需读取并缓存 5 分钟 |

全部来源均自动采集，不需要账号、Token、Cookie 或用户手工导入。公共市场、Wise 与汇丰失败时只回退到各自 D1 归档；银行聚合页缺失时返回明确警告和不可用状态，不允许用另一项汇率冒充。

来源准入只接受无需登录的官方接口或可靠第三方实时数据源。需要登录银行 App/网银才能看到的报价不进入可配置来源；如果无法找到口径可靠、可持续匿名采集的第三方源，则该银行不接入，也不创建空白配置项。宣传页示例或市场中间价不能冒充银行客户报价。

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

## 5. 香港银行 TT 排行

Worker 按币种读取公开聚合页，例如：

```http
GET https://yoyorate.com/compare/hk/hkd-to-aud
GET https://yoyorate.com/compare/hk/hkd-to-usd
```

当前覆盖中银香港、交通银行（香港）、中国建设银行（亚洲）、创兴、集友、招商永隆、中信银行（国际）、大新、星展、富邦、恒生、东亚、汇丰、工银亚洲、南洋商业、华侨、大众及上海商业银行，共 18 家。这里只代表能从同一公开页面取得可比 TT Buy / TT Sell 的零售银行，不等于香港金融管理局认可机构名册中的全部银行。

方向计算与汇丰一致：客户卖出 BASE 使用 BASE TT Buy，客户买入 QUOTE 使用 QUOTE TT Sell；外币交叉盘经 HKD 计算。列表按 1 BASE 可获得的 QUOTE 数量由高到低排序。某银行没有目标币种或缺少任一侧牌价时，保留银行名称并标记“暂不可用”，不推算缺失值。

Cron 在 UTC 00:00、08:00、16:00 读取 10 个非 HKD 币种页，在内存中推导 18 家银行全部可用有向币种对，并按最多 100 条一批归档；不为每个方向重复请求公开聚合页。页面访问 `/api/banks`、`/api/overview` 或 `/api/compare` 时只读取实时来源与最近归档，不再写 D1。

汇丰一行用官网匿名 JSON 覆盖聚合值并标记“官方直连”；其余银行标记“公开聚合”。响应包含原始来源链接、采集时间、计算口径与相对市场价差。聚合页可能比银行官网滞后数分钟，最终交易仍以银行确认页面为准。

## 6. 公开牌价边界

汇丰与其他银行的公开 TT 牌价可用于同方向比较，但不等于登录后优惠价、包含全部费用的最终到账汇率或保证成交价。FXPulse 页面必须显示来源、买卖方向、更新时间及指示性数据提示，不使用公共市场价冒充缺失的银行报价。

当前 YoYoRate 可比集合为 18 家。渣打及香港数字银行没有找到满足准入条件的匿名第三方实时客户牌价，因此不在当前注册表中；后续接入必须先验证第三方源的币种覆盖、买卖方向、更新时间与持续可用性。

## 7. D1 与降级

`provider_rate_snapshots` 保存来源、方向、报价类型、采集时间、来源更新时间和计算口径。读取规则：

- Wise：优先同方向归档；必要时可读取反方向并取倒数；
- 汇丰：只能读取完全相同方向的归档，禁止取倒数；
- 其他香港银行：Cron 每 8 小时全方向归档；只能读取完全相同方向；
- 实时请求成功显示“实时”；
- 实时请求失败但有归档显示“归档”；
- 两者都没有显示“暂不可用”。

盘中归档使用固定小时桶，保留 30 天；每天生成前一 UTC 日的日均点，保留 400 天。清理每次最多处理 12,000 个逻辑行，避免一次性删除造成免费额度突增。公共历史接口使用 Cache API：15 分钟内直接命中，之后可先返回 24 小时内的旧数据并后台刷新；全部外部接口设有 5 秒超时。

## 8. 验证

```bash
curl "https://fxpulse.177.best/api/compare?base=USD&quote=AUD"
curl "https://fxpulse.177.best/api/compare?base=AUD&quote=USD"
curl "https://fxpulse.177.best/api/banks?base=AUD&quote=USD"
curl "https://fxpulse.177.best/api/history?base=AUD&quote=USD&days=30&sources=market,wise,hsbc_public,bank_boc"
```

验收要点：

- 两个响应均包含 `market`、`wise`、`hsbc_public`；
- Wise 与汇丰无需配置 Secret 即可返回数字；
- 汇丰返回 `basis`，说明使用的 TT 计算口径；
- 反转页面、计算器、统一来源表、走势图和 canonical URL 同步切换。
- `/api/overview` 始终返回公共市场与 Wise，并只加载 `sources` 指定的额外来源；前端对全局配置和每张卡片分别执行最多 5 个限制。多个单卡配置合并请求时可形成超过 5 个的去重来源集合，未请求的银行不为总览重复采集。
- 银行接口返回 18 行，`availableBankCount` 与各行 `status` 一致；汇丰行为 `HSBC Hong Kong` 官方直连，其余行为 `YoYoRate` 公开聚合。
- 历史接口固定返回公共市场与 Wise，并按 `sources` 接受最多 5 个额外来源；银行数据不足时返回 `unavailable` 和原因，不借用公共市场数据。
