import csv
import io
import re
from datetime import datetime
from decimal import Decimal
from pathlib import Path


SOURCE_SQL = Path(r"C:\Users\Laptop\Downloads\symbols (27).sql")
OUTPUT_SQL = Path(r"C:\data\Projects\dTrader\new_pt1\deploy\symbols27_import.sql")

ASSET_CLASS_MAP = {
    1: "Forex",
    2: "Cryptocurrencies",
    3: "Metals",
    4: "ETFs",
    5: "Stocks",
    6: "Shares",      # user confirmed
    7: "Commodities",
    8: "Indices",
    9: "Energies",
    10: "Stocks",     # user confirmed
}

# market_type enum values available in DB: crypto, forex, commodities, indices, stocks
MARKET_MAP = {
    "Forex": "forex",
    "Cryptocurrencies": "crypto",
    "Metals": "commodities",
    "Commodities": "commodities",
    "Energies": "commodities",
    "Indices": "indices",
    "Stocks": "stocks",
    "Shares": "stocks",
    "ETFs": "stocks",
}


def q(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


def parse_mysql_inserts(sql_text: str):
    matches = list(
        re.finditer(r"INSERT INTO `symbols` \((.*?)\) VALUES\s*(.*?);", sql_text, flags=re.S)
    )
    if not matches:
        raise RuntimeError("No INSERT INTO `symbols` blocks found.")

    rows = []
    for m in matches:
        cols = [c.strip().strip("`") for c in m.group(1).split(",")]
        tuples = re.findall(r"\((.*?)\)(?:,|$)", m.group(2), flags=re.S)
        for tup in tuples:
            parts = next(
                csv.reader(
                    io.StringIO(tup),
                    delimiter=",",
                    quotechar="'",
                    escapechar="\\",
                    skipinitialspace=True,
                )
            )
            if len(parts) != len(cols):
                continue
            rows.append(dict(zip(cols, parts)))
    return rows


def safe_int(raw: str, default: int) -> int:
    try:
        return int((raw or "").strip() or default)
    except Exception:
        return default


def safe_decimal_str(raw: str, default: str) -> str:
    try:
        d = Decimal((raw or "").strip())
        return format(d, "f")
    except Exception:
        return default


def tick_size_from_precision(precision: int) -> str:
    precision = max(0, min(precision, 8))
    return format(Decimal(10) ** Decimal(-precision), "f")


def transform_row(src: dict):
    code = (src.get("name") or "").strip()
    if not code:
        return None

    asset_class_id = safe_int(src.get("asset_class_id") or "", 0)
    asset_class = ASSET_CLASS_MAP.get(asset_class_id)
    if not asset_class:
        return None

    market = MARKET_MAP[asset_class]
    name = (src.get("description") or "").strip() or code
    base_currency = ((src.get("base_asset") or "").strip() or code)[:10]
    quote_currency = ((src.get("quote_asset") or "").strip() or "USD")[:10]
    provider_symbol = ((src.get("symbol_apis") or "").strip() or code)[:50]

    digits = safe_int(src.get("digit") or "", 2)
    digits = max(0, min(digits, 12))
    price_precision = digits
    volume_precision = 2
    tick_size = tick_size_from_precision(price_precision if price_precision <= 8 else 8)
    contract_size = safe_decimal_str(src.get("lot_size") or "", "1")
    lot_min = "0.01"

    status = (src.get("status") or "").strip().lower()
    enabled = "true" if (not status or status == "active") else "false"
    pip_position = (src.get("pip_position") or "").strip()
    default_pip_position = safe_decimal_str(pip_position, "0") if pip_position else None

    return {
        "code": code[:50],
        "name": name[:255],
        "market": market,
        "base_currency": base_currency,
        "quote_currency": quote_currency,
        "digits": digits,
        "tick_size": tick_size,
        "contract_size": contract_size,
        "price_precision": price_precision,
        "lot_min": lot_min,
        "trading_enabled": enabled,
        "close_only": "false",
        "allow_new_orders": "true",
        "data_provider": "Binance",
        "provider_symbol": provider_symbol,
        "asset_class": asset_class,
        "volume_precision": volume_precision,
        "is_enabled": enabled,
        "default_pip_position": default_pip_position,
    }


def to_insert_sql(row: dict) -> str:
    default_pip = "NULL" if row["default_pip_position"] is None else row["default_pip_position"]
    return (
        "INSERT INTO symbols ("
        "code,name,market,base_currency,quote_currency,digits,tick_size,contract_size,price_precision,"
        "lot_min,trading_enabled,close_only,allow_new_orders,data_provider,provider_symbol,asset_class,"
        "volume_precision,is_enabled,default_pip_position"
        ") VALUES ("
        f"{q(row['code'])},{q(row['name'])},{q(row['market'])}::market_type,{q(row['base_currency'])},"
        f"{q(row['quote_currency'])},{row['digits']},{row['tick_size']},{row['contract_size']},"
        f"{row['price_precision']},{row['lot_min']},{row['trading_enabled']},{row['close_only']},"
        f"{row['allow_new_orders']},{q(row['data_provider'])},{q(row['provider_symbol'])},"
        f"{q(row['asset_class'])}::asset_class,{row['volume_precision']},{row['is_enabled']},{default_pip}"
        ");"
    )


def main():
    sql_text = SOURCE_SQL.read_text(encoding="utf-8", errors="ignore")
    source_rows = parse_mysql_inserts(sql_text)

    by_code = {}
    duplicates = 0
    for src in source_rows:
        tr = transform_row(src)
        if tr is None:
            continue
        if tr["code"] in by_code:
            duplicates += 1
        by_code[tr["code"]] = tr

    final_rows = list(by_code.values())
    backup_table = "symbols_backup_" + datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    OUTPUT_SQL.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    lines.append("-- Auto-generated by scripts/symbols27_prepare_import.py")
    lines.append("BEGIN;")
    lines.append(f"CREATE TABLE {backup_table} AS TABLE symbols;")
    lines.append("DELETE FROM symbols;")
    for r in final_rows:
        lines.append(to_insert_sql(r))
    lines.append("COMMIT;")
    OUTPUT_SQL.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"source_rows={len(source_rows)}")
    print(f"deduped_rows={len(final_rows)}")
    print(f"duplicate_codes_resolved={duplicates}")
    print(f"backup_table={backup_table}")
    print(f"import_sql={OUTPUT_SQL}")


if __name__ == "__main__":
    main()

