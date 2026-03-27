import csv
import io
import json
import re
from collections import Counter
from pathlib import Path


SOURCE_SQL = Path(r"C:\Users\Laptop\Downloads\symbols (27).sql")
OUTPUT_JSON = Path(r"C:\data\Projects\dTrader\new_pt1\deploy\symbols27_preview.json")

# User-confirmed mapping:
# - asset_class_id 6 -> Shares
# - asset_class_id 10 -> Stocks
ASSET_CLASS_MAP = {
    1: "Forex",
    2: "Cryptocurrencies",
    3: "Metals",
    4: "ETFs",
    5: "Stocks",
    6: "Shares",
    7: "Commodities",
    8: "Indices",
    9: "Energies",
    10: "Stocks",
}


def parse_mysql_symbols_inserts(sql_text: str):
    matches = list(
        re.finditer(r"INSERT INTO `symbols` \((.*?)\) VALUES\s*(.*?);", sql_text, flags=re.S)
    )
    if not matches:
        raise RuntimeError("Could not find INSERT INTO `symbols` blocks in source SQL.")

    all_tuples = []
    cols = None
    for m in matches:
        block_cols = [c.strip().strip("`") for c in m.group(1).split(",")]
        if cols is None:
            cols = block_cols
        values_blob = m.group(2)
        tuples = re.findall(r"\((.*?)\)(?:,|$)", values_blob, flags=re.S)
        all_tuples.extend(tuples)

    return cols, all_tuples, len(matches)


def to_rows(cols, tuples):
    rows = []
    bad_rows = 0
    for t in tuples:
        try:
            parsed = next(
                csv.reader(
                    io.StringIO(t),
                    delimiter=",",
                    quotechar="'",
                    escapechar="\\",
                    skipinitialspace=True,
                )
            )
        except Exception:
            bad_rows += 1
            continue

        if len(parsed) != len(cols):
            bad_rows += 1
            continue
        rows.append(dict(zip(cols, parsed)))
    return rows, bad_rows


def map_row(src):
    symbol_code = (src.get("name") or "").strip()
    if not symbol_code:
        return None

    asset_class_id_raw = (src.get("asset_class_id") or "").strip()
    try:
        asset_class_id = int(asset_class_id_raw)
    except Exception:
        return None

    asset_class = ASSET_CLASS_MAP.get(asset_class_id)
    if not asset_class:
        return None

    provider_symbol = ((src.get("symbol_apis") or "").strip() or symbol_code)
    base_currency = ((src.get("base_asset") or "").strip() or symbol_code)[:20]
    quote_currency = ((src.get("quote_asset") or "").strip() or "USD")[:20]

    digit_raw = (src.get("digit") or "").strip()
    try:
        price_precision = int(digit_raw) if digit_raw else 5
    except Exception:
        price_precision = 5
    price_precision = max(0, min(price_precision, 12))

    status = (src.get("status") or "").strip().lower()
    is_enabled = True if not status else status == "active"

    return {
        "symbol_code": symbol_code,
        "provider_symbol": provider_symbol,
        "asset_class": asset_class,
        "base_currency": base_currency,
        "quote_currency": quote_currency,
        "price_precision": price_precision,
        "volume_precision": 2,
        "is_enabled": is_enabled,
        "trading_enabled": is_enabled,
    }


def main():
    sql_text = SOURCE_SQL.read_text(encoding="utf-8", errors="ignore")
    cols, tuples, insert_blocks = parse_mysql_symbols_inserts(sql_text)
    src_rows, bad_rows = to_rows(cols, tuples)

    mapped = []
    skipped = 0
    for src in src_rows:
        m = map_row(src)
        if m is None:
            skipped += 1
            continue
        mapped.append(m)

    class_counts = Counter(r["asset_class"] for r in mapped)
    enabled_counts = Counter(r["asset_class"] for r in mapped if r["is_enabled"])

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(
        json.dumps(
            {
                "source_tuples": len(tuples),
                "insert_blocks": insert_blocks,
                "parsed_rows": len(src_rows),
                "bad_rows": bad_rows,
                "mapped_rows": len(mapped),
                "skipped_rows": skipped,
                "asset_class_counts": dict(class_counts),
                "enabled_counts": dict(enabled_counts),
                "sample_rows": mapped[:15],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"insert_blocks={insert_blocks}")
    print(f"source_tuples={len(tuples)}")
    print(f"parsed_rows={len(src_rows)}")
    print(f"bad_rows={bad_rows}")
    print(f"mapped_rows={len(mapped)}")
    print(f"skipped_rows={skipped}")
    print("asset_class_counts=" + json.dumps(dict(class_counts), ensure_ascii=True))
    print("enabled_counts=" + json.dumps(dict(enabled_counts), ensure_ascii=True))
    print(f"preview_file={OUTPUT_JSON}")


if __name__ == "__main__":
    main()

