# Non–USD-quoted symbol usage — read-only database check

**Purpose:** Determine whether any traders have used symbols whose `quote_currency` is not `USD` or `USDT`, to support a decision on disabling those symbols and relying on consistent USD-denominated account math.

**Rules followed:** Read-only `SELECT` only. No schema or data changes.

---

## 1. Connection details

| Item | Value |
|------|--------|
| **Method** | Host `psql` (not `docker exec`) |
| **Host / port** | `127.0.0.1` / `5434` |
| **Database** | `newpt` |
| **User** | `postgres` |
| **Password** | *(omitted — local dev default per `infra/docker-compose.yml` / `DATABASE_URL` examples in repo docs)* |

**Command pattern:**

```bash
PGPASSWORD='<local-password>' psql -h 127.0.0.1 -p 5434 -U postgres -d newpt -v ON_ERROR_STOP=1
```

**Connection:** Succeeded (`SELECT 1` probe).

---

## 2. Raw query results

### Query 1 — Symbols grouped by `quote_currency`

```text
 quote_currency | symbol_count | enabled_count |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          enabled_symbols                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           
----------------+--------------+---------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 ARS            |            1 |             1 | USDARS
 AUD            |            3 |             3 | EURAUD, GBPAUD, XAUAUD
 BRL            |            1 |             1 | USDBRL
 CAD            |            5 |             5 | AUDCAD, EURCAD, GBPCAD, NZDCAD, USDCAD
 CHF            |            6 |             6 | AUDCHF, CADCHF, EURCHF, GBPCHF, NZDCHF, USDCHF
 CLP            |            1 |             1 | USDCLP
 CNH            |            2 |             2 | EURCNH, USDCNH
 COP            |            1 |             1 | USDCOP
 CZK            |            3 |             3 | EURCZK, GBPCZK, USDCZK
 DKK            |            8 |             8 | AUDDKK, CADDKK, CHFDKK, EURDKK, GBPDKK, NOKDKK, NZDDKK, USDDKK
 EUR            |            2 |             2 | XAGEUR, XAUEUR
 GBP            |            1 |             1 | EURGBP
 GEL            |            1 |             1 | USDGEL
 HKD            |            5 |             5 | AUDHKD, EURHKD, GBPHKD, SGDHKD, USDHKD
 HUF            |            6 |             6 | AUDHUF, CHFHUF, EURHUF, GBPHUF, NZDHUF, USDHUF
 IDR            |            1 |             1 | USDIDR
 ILS            |            2 |             2 | EURILS, USDILS
 INR            |            1 |             1 | USDINR
 JPY            |           17 |            17 | AUDJPY, CADJPY, CHFJPY, CNHJPY, DKKJPY, EURJPY, GBPJPY, HKDJPY, MXNJPY, NOKJPY, NZDJPY, PLNJPY, SEKJPY, SGDJPY, TRYJPY, USDJPY, ZARJPY
 KRW            |            1 |             1 | USDKRW
 MXN            |            6 |             6 | CADMXN, CHFMXN, EURMXN, GBPMXN, NZDMXN, USDMXN
 NGN            |            1 |             1 | USDNGN
 NOK            |            9 |             9 | AUDNOK, CADNOK, CHFNOK, DKKNOK, EURNOK, GBPNOK, NZDNOK, SEKNOK, USDNOK
 NZD            |            3 |             3 | AUDNZD, EURNZD, GBPNZD
 PLN            |            6 |             6 | AUDPLN, CADPLN, CHFPLN, EURPLN, GBPPLN, USDPLN
 RMB            |            1 |             1 | USDRMB
 RUB            |            2 |             2 | EURRUB, USDRUB
 RUR            |            2 |             2 | EURRUR, USDRUR
 SEK            |            9 |             9 | AUDSEK, CADSEK, CHFSEK, DKKSEK, EURSEK, GBPSEK, NOKSEK, NZDSEK, USDSEK
 SGD            |            7 |             7 | AUDSGD, CADSGD, CHFSGD, EURSGD, GBPSGD, NZDSGD, USDSGD
 THB            |            2 |             2 | AUDTHB, USDTHB
 TRY            |            4 |             4 | CHFTRY, EURTRY, GBPTRY, USDTRY
 USD            |          338 |           338 | A, AA, AACG, AACT, AADI, AAGR, AAL, AAME, AAN, AAOI, AAON, AAP, AAPL, AAT, ABAT, ABBV, ABCB, ABCL, ABEO, ABEV, ABG, ABLV, ABM, ABNB, ABOS, ABR, ABR-PD, ABR-PE, ABR-PF, ABSI, ABT, ABTS, ABUS, ABVC, ABVE, ABVX, AC, ACA, ACAD, ACB, ACCO, ACDC, ACEL, ACET, ACGL, ACGLN, ACGLO, ACHC, ACHR, ACHV, ACI, ACIC, ACIU, ACIW, ACLS, ACM, ACMR, ACN, ACNB, ACON, ACP, ACP-PA, ACR, ACR-PC, ACR-PD, ACRE, ACRS, ACRV, ACT, ACTG, ACU, ACV, ACVA, ADAG, ADAP, ADBE, ADC, ADC-PA, ADCT, ADEA, ADI, ADIL, ADM, ADMA, ADNT, ADP, ADSE, ADSK, ADT, ADUS, ADV, ADX, ADXN, AEE, AEF, AEG, AEHL, AEI, AEM, AENT, AEO, AEP, AER, AERT, AES, AESI, AEVA, AEYE, AFB, AFBI, AFG, AFL, AFRI, AFRM, AFYA, AG, AGAE, AGCO, AGD, AGEN, AGI, AGL, AGM, AGM-A, AGM-PD, AGM-PE, AGM-PF, AGM-PG, AGMH, AGNC, AGNCL, AGNCM, AGNCN, AGNCO, AGNCP, AGO, AGRO, AGX, AGYS, AHCO, AHG, AHL-PD, AHL-PE, AHR, AHT, AHT-PF, AHT-PG, AHT-PH, AHT-PI, AI, AIG, AIMD, AIN, AIO, AIP, AIR, AIRE, AIRG, AIRI, AIRJ, AIRS, AISP, AIT, AIV, AJG, AKA, AKAM, AKAN, AKO-A, AKO-B, AKR, AKTX, AL, ALAB, ALAR, ALB, ALB-PA, ALC, ALCO, ALCY, ALDX, ALEC, ALG, ALGT, ALK, ALKS, ALKT, ALL, ALL-PI, ALL-PJ, ALLE, ALLO, ALLR, ALNT, ALNY, ALOT, ALRM, ALT, ALTG, ALTG-PA, ALTI, ALTO, ALTS, ALV, ALX, ALXO, ALZN, AM, AMAL, AMAT, AMBP, AMC, AMCR, AMD, AME, AMG, AMGN, AMH, AMH-PG, AMH-PH, AMIX, AMKR, AMLX, AMP, AMPG, AMPX, AMPY, AMR, AMRC, AMSF, AMST, AMT, AMTD, AMWD, AMX, AMZN, ANDE, ANET, ANGH, ANL, ANNX, ANRO, ANSC, ANTX, ANVS, AOD, AOMR, AON, AORT, AOS, AOSL, AOUT, AP, APAM, APD, APEI, APG, APH, API, APLD, APLE, APLM, APLS, APM, APO, APO-PA, APP, APPF, APPS, APRE, APT, APWC, APYX, AQB, AQST, AR, ARAY, ARBB, ARBE, ARCB, ARCC, ARCT, ARE, AREC, ARES, ARGX, ARHS, ARI, ARKO, ARKR, ARL, ARLO, ARM, ARMK, ARMN, AROW, ARQ, ARQQ, ARQT, ARR, ARR-PC, ARRY, ARTW, ARW, AS, ASA, ASB, ASB-PE, ASB-PF, ASC, ASG, ASGI, ASGN, ASH, ASIX, ASLE, ASM, ASML, ASNS, ASPI, ASPN, ASPS, ASR, ASRV, ASST, ASTC, ASTE, AUDUSD, EURUSD, GBPUSD, INTC, MSFT, NVDA, NZDUSD, XAGUSD, XAUUSD, XPDUSD, XPTUSD
 USDT           |          123 |           123 | 1000PEPEUSDT, 1000SATSUSDT, 1INCHUSDT, AAVEUSDT, ADAUSDT, AGIXUSDT, ALGOUSDT, APEUSDT, APTUSDT, ARBUSDT, ARKMUSDT, ASTRUSDT, ATOMUSDT, AVAXUSDT, AXSUSDT, BATUSDT, BCHUSDT, BLURUSDT, BNBUSDT, BONKUSDT, BTCUSDT, C98USDT, CELOUSDT, CFXUSDT, CHZUSDT, COMPUSDT, COTIUSDT, CRVUSDT, CVCUSDT, DASHUSDT, DENTUSDT, DOGEUSDT, DOTUSDT, DYDXUSDT, EGLDUSDT, ENJUSDT, ENSUSDT, EOSUSDT, ETCUSDT, ETHUSDT, FETUSDT, FILUSDT, FLOKIUSDT, FLOWUSDT, FTMUSDT, GALAUSDT, GASUSDT, GMTUSDT, GRTUSDT, HBARUSDT, HOTUSDT, ICPUSDT, ICXUSDT, IMXUSDT, INJUSDT, JASMYUSDT, KASUSDT, KAVAUSDT, KEYUSDT, KNCUSDT, KSMUSDT, LDOUSDT, LINKUSDT, LQTYUSDT, LTCUSDT, MAGICUSDT, MANAUSDT, MANTAUSDT, MATICUSDT, MINAUSDT, MKRUSDT, NEARUSDT, NMRUSDT, OCEANUSDT, OMGUSDT, ONEUSDT, OPUSDT, ORDIUSDT, PENDLEUSDT, PEPEUSDT, PHBUSDT, POLUSDT, PORTALUSDT, POWRUSDT, PYTHUSDT, QNTUSDT, QTUMUSDT, RDNTUSDT, RENDERUSDT, RPLUSDT, RSRUSDT, RUNEUSDT, SANDUSDT, SEIUSDT, SHIBUSDT, SKLUSDT, SNXUSDT, SOLUSDT, SSVUSDT, STORJUSDT, STRKUSDT, STXUSDT, SUIUSDT, SXPUSDT, THETAUSDT, TIAUSDT, TLMUSDT, TONUSDT, TRXUSDT, UNIUSDT, VETUSDT, WIFUSDT, WLDUSDT, WOOUSDT, XAIUSDT, XLMUSDT, XMRUSDT, XRPUSDT, YFIUSDT, ZECUSDT, ZILUSDT, ZROUSDT, ZRXUSDT
 ZAR            |            5 |             5 | AUDZAR, CHFZAR, EURZAR, GBPZAR, USDZAR
(35 rows)
```

### Query 2 — Orders on non–USD/USDT-quoted symbols

```text
 quote_currency | total_orders | distinct_users | filled_orders | pending_orders |          first_order          |       most_recent_order       
----------------+--------------+----------------+---------------+----------------+-------------------------------+-------------------------------
 IDR            |           14 |              3 |            14 |              0 | 2026-04-15 19:04:24.49129+00  | 2026-04-28 13:59:45.458453+00
 HUF            |           11 |              3 |            11 |              0 | 2026-04-15 19:03:51.897307+00 | 2026-04-27 21:22:56.858937+00
 AUD            |            2 |              2 |             2 |              0 | 2026-04-15 19:13:32.01894+00  | 2026-04-27 21:37:11.353456+00
 COP            |            2 |              1 |             2 |              0 | 2026-04-29 08:26:26.194595+00 | 2026-04-29 08:26:44.516527+00
 JPY            |            1 |              1 |             1 |              0 | 2026-04-15 14:05:02.23249+00  | 2026-04-15 14:05:02.23249+00
(5 rows)
```

### Query 3 — Open positions on non–USD/USDT-quoted symbols

```text
 quote_currency | symbol | open_positions | distinct_users | total_size 
----------------+--------+----------------+----------------+------------
(0 rows)
```

### Query 4 — Per-user breakdown (top 50)

```text
           email           |               user_id                | quote_currency | orders_placed | open_positions_now | closed_positions 
---------------------------+--------------------------------------+----------------+---------------+--------------------+------------------
 mabhattiltd5@gmail.com    | 4acfaa5c-de52-40c6-b5c0-edbdf65b8426 | IDR            |            10 |                  0 |                0
 mimuxagiqu@mailinator.com | 2e2b497c-220f-42e4-bbb7-0fd2146fe7e8 | HUF            |             5 |                  0 |                0
 mabhattiltd5@gmail.com    | 4acfaa5c-de52-40c6-b5c0-edbdf65b8426 | HUF            |             4 |                  0 |                0
 ayyazbhatti40@gmail.com   | 1f80aa7c-966f-4a6e-888d-2fb4b1214219 | IDR            |             3 |                  0 |                0
 mabhattiltd5@gmail.com    | 4acfaa5c-de52-40c6-b5c0-edbdf65b8426 | COP            |             2 |                  0 |                0
 mojuly@mailinator.com     | 2afedf25-f21d-48a3-ac82-86b4bccbf267 | HUF            |             2 |                  0 |                0
 mabhattiltd5@gmail.com    | 4acfaa5c-de52-40c6-b5c0-edbdf65b8426 | JPY            |             1 |                  0 |                0
 mimuxagiqu@mailinator.com | 2e2b497c-220f-42e4-bbb7-0fd2146fe7e8 | AUD            |             1 |                  0 |                0
 mimuxagiqu@mailinator.com | 2e2b497c-220f-42e4-bbb7-0fd2146fe7e8 | IDR            |             1 |                  0 |                0
 ayyazbhatti40@gmail.com   | 1f80aa7c-966f-4a6e-888d-2fb4b1214219 | AUD            |             1 |                  0 |                0
(10 rows)
```

### Query 5 — Sanity counts

```text
 total_symbols | enabled_symbols | total_orders | total_positions | open_positions 
---------------+-----------------+--------------+-----------------+----------------
           586 |             586 |          179 |               0 |              0
(1 row)
```

---

## 3. Plain-English interpretation

### Query 1

The catalog has **586** symbols, all **trading-enabled** in this database. Besides `USD` and `USDT`, there are **33** other `quote_currency` values (forex/metal crosses, ARS, CLP, etc.), each with a small set of instrument codes. So the platform *can* offer many non-USD-quoted pairs.

### Query 2

There **have** been orders on non–USD/USDT quotes: **30** distinct orders in total, spread across **IDR** (14), **HUF** (11), **AUD** (2), **COP** (2), and **JPY** (1). All counted orders are **`filled`**; none **`pending`**. Dates cluster in **April 2026**, suggesting a short burst of testing rather than sustained production flow.

### Query 3

**No** currently **open** positions on non–USD/USDT-quoted symbols. There is therefore **no** live open exposure in the `positions` table for those instruments *at the time of this snapshot*.

### Query 4

**Ten** `(user, quote_currency)` groups account for all non–USD/USDT order activity. Several addresses are disposable (`mailinator.com`); others are Gmail. **Per this query’s `open_positions_now` and `closed_positions` columns:** all show **0** — consistent with Query 5 showing **zero rows in `positions` overall** (so this join does not surface historical closed rows from `positions`; order history still lives in `orders`).

### Query 5

Overall activity on this instance is modest (**179** orders). Critically, **`positions` has 0 rows** and **0 open positions** for *any* symbol — not only non-USD. That may mean this DB is not the full production ledger, or positions were never synced here, or data was reset. **Interpret non-USD conclusions in that context:** order table proves *some* non-USD-quoted trading occurred; position table does not currently hold any row to corroborate open/closed lifecycle here.

---

## 4. Recommendation (explicit answers)

### Have any non-USD-quoted symbols ever been traded?

**Yes.** There are **30** filled orders on symbols with `quote_currency` ∉ `{USD, USDT}` (Query 2), across **5** quote currencies, in **April 2026**.

### Are any non-USD positions currently open?

**No** — Query 3 returned **no rows** (zero open non–USD/USDT positions). Query 5 also reports **0** open positions in the entire `positions` table.

### Recommendation: Is it safe to disable non-USD-quoted symbols in production?

**⚠️ Caution** (not ✅ “no real activity”, not 🚨 “blocking open positions”).

- **Pros for Path A:** No open non-USD (or any) positions in **`positions`** on this snapshot, so you are not stranding open DB positions by toggling `trading_enabled` / access here.
- **Cons / caveats:** (1) **Order history exists** for non-USD quotes (30 orders); disabling symbols may affect how those orders display or whether regression tests assume certain symbols exist. (2) **This database may not match production** if production still has `positions` rows or more orders — re-run the same five queries on the **production** replica before a final go/no-go. (3) A few **non-disposable emails** appear in Query 4 — treat as low-volume real or QA accounts that should be notified if you remove instruments.

**If this were treated as 🚨 (it is not, given Query 3):** there would be open non-USD positions to list — there are none. **Affected accounts by past non-USD *orders* (Query 4):**

| Email | User ID | Quote currencies (from Query 4 rows) |
|-------|---------|----------------------------------------|
| mabhattiltd5@gmail.com | `4acfaa5c-de52-40c6-b5c0-edbdf65b8426` | IDR, HUF, COP, JPY |
| mimuxagiqu@mailinator.com | `2e2b497c-220f-42e4-bbb7-0fd2146fe7e8` | HUF, AUD, IDR |
| ayyazbhatti40@gmail.com | `1f80aa7c-966f-4a6e-888d-2fb4b1214219` | IDR, AUD |
| mojuly@mailinator.com | `2afedf25-f21d-48a3-ac82-86b4bccbf267` | HUF |

---

## 5. One-line numeric summary

**Non-USD/USDT orders (sum of Query 2 `total_orders`):** **30** · **Open non-USD/USDT positions (Query 3 row count):** **0**.

---

*Report generated from read-only SQL against `newpt` @ `127.0.0.1:5434`.*
