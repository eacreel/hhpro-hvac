"""
convert_gas_packs.py — Convert GAS PACKS DATA.xlsx to gas-packs.json

Reads the Excel workbook and produces a single JSON file with:
  - productType, manufacturer metadata
  - filterOptions  (unique sorted values for each filter column)
  - systems[]      (one entry per row with schedule, filters, docs)

Place this script in the DATA/ folder alongside GAS PACKS DATA.xlsx.
Output goes to DATA/JSON/gas-packs.json.

Usage:
    cd DATA
    python convert_gas_packs.py
"""

import json
import os
import sys
import openpyxl

# ---------------------------------------------------------------------------
# Configuration — uses script's own directory so it works no matter
# where you run it from (double-click, terminal, VS Code, etc.)
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_FILE = os.path.join(SCRIPT_DIR, "GAS PACKS DATA.xlsx")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "JSON")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "gas-packs.json")

# Schedule columns: A(1) through Y(25)
# Rows 1-3 = headers, rows 4-165 = data
SCHEDULE_ROW_START = 4
SCHEDULE_ROW_END = 165  # inclusive

# Filter columns: AA(27) through AF(32), header in row 3
FILTER_COLS = {
    27: "size",             # AA — SIZE
    28: "electrical",       # AB — ELECTRICAL
    29: "efficiency",       # AC — EFFICIENCY
    30: "coolingStages",    # AD — COOLING STAGES
    31: "gasHeat",          # AE — HIGH/MEDIUM/LOW GAS HEAT
    32: "hgrh",             # AF — HGRH
}

# Document columns: AH(34) through AL(38), header in row 3
DOC_COLS = {
    34: "submittal",            # AH — SUBMITTAL (SYSTEM)
    35: "engineeringManual",    # AI — ENGINEERING MANUAL
    36: "installationManual",   # AJ — INSTALLATION MANUAL
    37: "revit",                # AK — REVIT
    38: "cad",                  # AL — CAD
}

# Document file extensions — REVIT and CAD are zip, everything else is pdf
DOC_EXTENSIONS = {
    "submittal":            ".pdf",
    "engineeringManual":    ".pdf",
    "installationManual":   ".pdf",
    "revit":                ".zip",
    "cad":                  ".zip",
}

# Asset subfolder names for each doc type (used in the file path)
DOC_SUBFOLDERS = {
    "submittal":            "SUBMITTALS",
    "engineeringManual":    "ENGINEERING MANUALS",
    "installationManual":   "INSTALLATION MANUALS",
    "revit":                "REVIT",
    "cad":                  "CAD",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def clean_value(val):
    """Return a cleaned value — strip strings, leave numbers as-is."""
    if val is None:
        return None
    if isinstance(val, str):
        val = val.strip()
        return val if val else None
    return val


def to_number(val):
    """Convert to int or float if possible, otherwise return as-is."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        # Return int if it's a whole number
        return int(val) if val == int(val) else val
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        # Don't parse slash-containing values like "208/3" as numbers
        if "/" in val:
            return val
        try:
            f = float(val)
            return int(f) if f == int(f) else f
        except ValueError:
            return val
    return val


def sort_filter_values(values, key):
    """Sort filter option values appropriately per filter type."""
    # Numeric sorts for size and cooling stages
    if key in ("size", "coolingStages"):
        nums = []
        strs = []
        for v in values:
            try:
                nums.append(float(v) if "." in str(v) else int(v))
            except (ValueError, TypeError):
                strs.append(str(v))
        nums.sort()
        # Convert back to display strings
        result = []
        for n in nums:
            result.append(str(int(n)) if n == int(n) else str(n))
        result.extend(sorted(strs))
        return result

    # Electrical: sort by voltage numerically (e.g., "208/3" before "460/3")
    if key == "electrical":
        def elec_sort_key(v):
            try:
                return int(str(v).split("/")[0])
            except (ValueError, IndexError):
                return 9999
        return sorted(values, key=elec_sort_key)

    # Gas heat: enforce HIGH, MEDIUM, LOW order
    if key == "gasHeat":
        order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
        return sorted(values, key=lambda v: order.get(str(v).upper(), 99))

    # Default: alphabetical
    return sorted(values, key=lambda v: str(v).upper())


# ---------------------------------------------------------------------------
# Main Conversion
# ---------------------------------------------------------------------------
def convert():
    print(f"Script directory: {SCRIPT_DIR}")
    print(f"Looking for: {INPUT_FILE}")

    if not os.path.isfile(INPUT_FILE):
        print(f"\nERROR: Input file not found: {INPUT_FILE}")
        print(f"\nFiles in script directory:")
        for f in os.listdir(SCRIPT_DIR):
            print(f"  {f}")
        sys.exit(1)

    print(f"Reading {INPUT_FILE}...")
    wb = openpyxl.load_workbook(INPUT_FILE, data_only=True)
    ws = wb.active

    systems = []
    filter_option_sets = {key: set() for key in FILTER_COLS.values()}

    system_index = 0

    for row_num in range(SCHEDULE_ROW_START, SCHEDULE_ROW_END + 1):
        # Skip completely empty rows
        model = clean_value(ws.cell(row_num, 3).value)
        if not model:
            continue

        system_index += 1
        sys_id = f"gas-pack-{system_index}"

        # --- Schedule data (columns A-Y) ---
        schedule = {
            "tag":              clean_value(ws.cell(row_num, 1).value),
            "make":             clean_value(ws.cell(row_num, 2).value),
            "model":            clean_value(ws.cell(row_num, 3).value),
            "nomTons":          to_number(ws.cell(row_num, 4).value),
            "cfm":              to_number(ws.cell(row_num, 5).value),
            "esp":              to_number(ws.cell(row_num, 6).value),
            "tesp":             to_number(ws.cell(row_num, 7).value),
            "totalCapacity":    to_number(ws.cell(row_num, 8).value),
            "sensibleCapacity": to_number(ws.cell(row_num, 9).value),
            "efficiency":       clean_value(ws.cell(row_num, 10).value),
            "edb":              to_number(ws.cell(row_num, 11).value),
            "ewb":              to_number(ws.cell(row_num, 12).value),
            "ldb":              to_number(ws.cell(row_num, 13).value),
            "lwb":              to_number(ws.cell(row_num, 14).value),
            "inputMbh":         to_number(ws.cell(row_num, 15).value),
            "outputMbh":        to_number(ws.cell(row_num, 16).value),
            "heatingEat":       to_number(ws.cell(row_num, 17).value),
            "heatingLat":       to_number(ws.cell(row_num, 18).value),
            "hgrh":             clean_value(ws.cell(row_num, 19).value),
            "coolingStages":    to_number(ws.cell(row_num, 20).value),
            "voltPh":           clean_value(ws.cell(row_num, 21).value),
            "indoorMotorHp":    to_number(ws.cell(row_num, 22).value),
            "mca":              to_number(ws.cell(row_num, 23).value),
            "mocp":             to_number(ws.cell(row_num, 24).value),
            "notes":            clean_value(ws.cell(row_num, 25).value),
        }

        # --- Filter data (columns AA-AF) ---
        filters = {}
        for col_num, key in FILTER_COLS.items():
            raw = clean_value(ws.cell(row_num, col_num).value)
            if raw is not None:
                # Store filters as strings for consistent matching
                filters[key] = str(raw).strip()
                filter_option_sets[key].add(filters[key])
            else:
                filters[key] = None

        # --- Documentation data (columns AH-AL) ---
        docs = {}
        for col_num, key in DOC_COLS.items():
            raw = clean_value(ws.cell(row_num, col_num).value)
            if raw:
                ext = DOC_EXTENSIONS[key]
                subfolder = DOC_SUBFOLDERS[key]
                docs[key] = f"{subfolder}/{raw}{ext}"
            else:
                docs[key] = None

        # --- Assemble system ---
        systems.append({
            "id":       sys_id,
            "schedule": schedule,
            "filters":  filters,
            "docs":     docs,
        })

    # --- Build filterOptions (sorted unique values) ---
    filter_options = {}
    for key, values in filter_option_sets.items():
        filter_options[key] = sort_filter_values(list(values), key)

    # --- Build output ---
    output = {
        "productType":   "Light Commercial RTUs - Gas",
        "manufacturer":  "Daikin",
        "filterOptions": filter_options,
        "systems":       systems,
    }

    # --- Write JSON ---
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nSUCCESS: Wrote {len(systems)} systems to {OUTPUT_FILE}")
    print(f"\nFilter options:")
    for key, vals in filter_options.items():
        print(f"  {key}: {vals}")


if __name__ == "__main__":
    convert()
    input("\nPress Enter to close...")