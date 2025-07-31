#!/usr/bin/env python3
"""
read_kpi_json.py

Script to load the KPI.json file, convert it to CSV for analysis, and generate a JavaScript module
(`kpiData.js`) exporting the KPI dataset for use in a dashboard frontend.

Usage:
    python read_kpi_json.py [--to-csv kpis.csv] [--to-js kpiData.js] [--pretty]
"""
import json
import argparse
import os
import sys

try:
    import pandas as pd
except ImportError:
    pd = None


DEFAULT_INPUT = 'KPI.json'


def load_json(file_path):
    """Load JSON data from a file."""
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def to_csv(data, output_path):
    """Flatten JSON into CSV and write to disk."""
    if pd is None:
        raise ImportError("Pandas is required for CSV export. Install with: pip install pandas")
    df = pd.json_normalize(data)
    df.to_csv(output_path, index=False)
    print(f"CSV written to {output_path}")


def to_js_module(data, output_path, var_name='kpiData'):
    """Generate a JavaScript module exporting the given data."""
    js_content = f"export const {var_name} = " + json.dumps(data, indent=2) + ";\n"
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(js_content)
    print(f"JS module written to {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Load and transform KPI JSON for dashboard consumption."
    )
    parser.add_argument(
        '-i', '--input', default=DEFAULT_INPUT,
        help="Path to the KPI JSON file (default: KPI.json)."
    )
    parser.add_argument(
        '--to-csv', metavar='OUTPUT',
        help="Convert the KPI data to CSV and save to OUTPUT. Requires pandas."
    )
    parser.add_argument(
        '--to-js', metavar='OUTPUT',
        help="Generate a JavaScript module exporting the KPI data to OUTPUT."
    )
    parser.add_argument(
        '-p', '--pretty', action='store_true',
        help="Pretty-print the raw JSON and exit."
    )
    args = parser.parse_args()

    try:
        data = load_json(args.input)
    except Exception as e:
        print(f"Error loading JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if args.pretty:
        print(json.dumps(data, indent=4, ensure_ascii=False))
        sys.exit(0)

    if args.to_csv:
        try:
            to_csv(data, args.to_csv)
        except Exception as e:
            print(f"CSV export failed: {e}", file=sys.stderr)
            sys.exit(1)

    if args.to_js:
        try:
            to_js_module(data, args.to_js)
        except Exception as e:
            print(f"JS module export failed: {e}", file=sys.stderr)
            sys.exit(1)

    if not any([args.pretty, args.to_csv, args.to_js]):
        print("No output option specified. Use --pretty, --to-csv or --to-js.")
        sys.exit(0)


if __name__ == "__main__":
    main()
