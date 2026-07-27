r"""
HHpro - Excel to JSON Converter
================================

Converts product data Excel files in this folder to JSON files that the
HHpro website uses to populate the mechanical schedules, filters, and
documentation for each product type.

Location (in the site's folder structure):
    HHpro\DATA\DATA FILES\convert_to_json.py

How it runs:
    1. Looks for every .xlsx file in the folder this script lives in.
    2. Matches each file against the PRODUCT_CONFIGS dictionary below.
    3. Reads the SCHEDULE tab and SCHEDULE NOTES tab from each matched file.
    4. Writes a .json file (same base name) into ..\JSON\ (i.e.
       HHpro\DATA\JSON\).

What this script DOES NOT do:
    - It does not check whether the filenames referenced in the Excel
      sheets actually exist on disk in ASSETS/. That check lives in the
      separate `validate_files.py` script next to this one - run it any
      time you want to know which filenames in your JSONs don't match
      real files in your ASSETS folders.

How to add a new product type:
    1. Drop the new .xlsx file into HHpro\DATA\DATA FILES\.
    2. Add one entry to PRODUCT_CONFIGS below (filename, productType,
       outputFileName, headerRows, dataStartRow, supportsMultiRow,
       assetsFolder, searchSchema).
    3. Run this script.

How to add a new DOCUMENTATION column:
    1. Add the column to row 2 of the DOCUMENTATION range in the Excel
       file(s). Use a name that starts with one of the prefixes in
       DOC_COLUMN_MAP below (e.g. "WIRING DIAGRAM" would need a new
       entry added to DOC_COLUMN_MAP first).
    2. If the column name uses a prefix not yet in DOC_COLUMN_MAP, add
       it here - key it to the ASSETS subfolder the files should live
       in and the expected file extension.
"""

import json
import os
import re
import sys
from datetime import datetime

import openpyxl
from openpyxl.utils import get_column_letter, column_index_from_string


# -----------------------------------------------------------------------------
# PRODUCT CONFIGS
# -----------------------------------------------------------------------------
# One entry per Excel data file. The key is the input filename (exact, case
# sensitive, including '.xlsx').
#
# Fields:
#   productType        Human-readable product name for the site.
#   outputFileName     Name of the JSON file this produces (no folder path).
#   headerRows         Number of header rows below row 1 but above the data.
#                      e.g. GAS PACKS has schedule-title in row 2 and column
#                      headers in rows 3-4 -> headerRows = 3.
#   dataStartRow       1-based row where the first data row begins.
#   supportsMultiRow   True if one selection can span multiple rows (detected
#                      via merged cells). Currently only mini-splits.
#   assetsFolder       Name of this product's folder under HHpro/ASSETS/.
#                      Used by validate_files.py to check filenames against
#                      real files on disk.
#   searchSchema       Drives the Design Search page on the site. Two parts:
#                        displayName  - shown in the category picker
#                        description  - one-line blurb shown above the form
#                        targets      - list of numeric columns the engineer
#                                       can search by (target value +/- a
#                                       tolerance %). Each target = dict with
#                                       label, col (Excel column letter),
#                                       unit (display string), and
#                                       defaultTolerance (percent prefilled
#                                       in the form). Pass an empty list for
#                                       products where filter dropdowns alone
#                                       are enough (e.g. VFDs - engineers
#                                       size them to an exact HP).
# -----------------------------------------------------------------------------

PRODUCT_CONFIGS = {
    "GAS PACKS DATA.xlsx": {
        "productType": "GAS PACK RTUS",
        "outputFileName": "gas_packs.json",
        "headerRows": 3,
        "dataStartRow": 5,
        "supportsMultiRow": False,
        "assetsFolder": "GAS PACKS",
        "searchSchema": {
            "displayName": "Gas Pack RTUs",
            "description": "Packaged rooftop units. Enter design loads and the page returns models that meet the targets within your tolerance.",
            "targets": [
                {"label": "Nominal Tons",             "col": "C", "unit": "tons",  "defaultTolerance": 10},
                {"label": "Total Cooling Capacity",   "col": "G", "unit": "BTU/h", "defaultTolerance": 10},
                {"label": "Sensible Cooling Capacity","col": "H", "unit": "BTU/h", "defaultTolerance": 10},
                {"label": "Heating Output",           "col": "O", "unit": "MBH",   "defaultTolerance": 10},
                {"label": "Airflow",                  "col": "D", "unit": "CFM",   "defaultTolerance": 10},
            ],
        },
    },
    "MARVAIR DATA.xlsx": {
        "productType": "MARVAIR VERTICAL WALL MOUNT",
        "outputFileName": "marvair.json",
        "headerRows": 2,
        "dataStartRow": 4,
        "supportsMultiRow": False,
        "assetsFolder": "MARVAIR",
        "searchSchema": {
            "displayName": "Marvair Vertical Wall Mount",
            "description": "Vertical wall-mount packaged air handling units. Enter design loads and the page returns models that meet the targets within your tolerance.",
            "targets": [
                {"label": "Nominal Size",             "col": "C", "unit": "tons",  "defaultTolerance": 10},
                {"label": "Total Cooling Capacity",   "col": "E", "unit": "BTU/h", "defaultTolerance": 10},
                {"label": "Sensible Cooling Capacity","col": "F", "unit": "BTU/h", "defaultTolerance": 10},
                {"label": "Electric Heat",            "col": "I", "unit": "kW",    "defaultTolerance": 10},
                {"label": "Airflow",                  "col": "D", "unit": "CFM",   "defaultTolerance": 10},
            ],
        },
    },
    "MINI SPLIT DATA.xlsx": {
        "productType": "MINI SPLITS",
        "outputFileName": "mini_splits.json",
        "headerRows": 5,
        "dataStartRow": 7,
        "supportsMultiRow": True,
        "assetsFolder": "MINI SPLITS",
        "searchSchema": {
            "displayName": "Mini Splits",
            "description": "Ductless split systems (1:1 and multi-zone). Enter per-zone capacity targets; results include systems with at least one indoor unit matching.",
            "targets": [
                {"label": "Indoor Unit Cooling Capacity",             "col": "D", "unit": "BTU/h", "defaultTolerance": 10},
                {"label": "Indoor Unit Sensible Capacity",            "col": "E", "unit": "BTU/h", "defaultTolerance": 10},
                {"label": "Indoor Unit Heating Capacity (Heat Pump)", "col": "G", "unit": "BTU/h", "defaultTolerance": 10},
                {"label": "Indoor Unit Airflow",                      "col": "A", "unit": "CFM",   "defaultTolerance": 15},
            ],
        },
    },
    "MULTI POSITION SPLIT DATA.xlsx": {
        "productType": "MULTI POSITION SPLITS",
        "outputFileName": "multi_position_splits.json",
        "headerRows": 4,
        "dataStartRow": 6,
        "supportsMultiRow": False,
        "assetsFolder": "MULTI POSITION SPLITS",
        "searchSchema": {
            "displayName": "Multi Position Splits",
            "description": "Conventional split systems with a multi-position air handler + outdoor condensing unit. Enter design loads and the page returns models that meet the targets within your tolerance.",
            "targets": [
                {"label": "Indoor Cooling Capacity",    "col": "I", "unit": "BTU/h", "defaultTolerance": 10},
                {"label": "Indoor Sensible Capacity",   "col": "J", "unit": "BTU/h", "defaultTolerance": 10},
                {"label": "Heat Pump Heating Capacity", "col": "U", "unit": "BTU/h", "defaultTolerance": 10},
                {"label": "Aux. Electric Heat",         "col": "L", "unit": "kW",    "defaultTolerance": 10},
                {"label": "Indoor Airflow",             "col": "C", "unit": "CFM",   "defaultTolerance": 10},
            ],
        },
    },
    "GAS SPLIT DATA.xlsx": {
        "productType": "GAS SPLITS",
        "outputFileName": "gas_splits.json",
        "headerRows": 4,
        "dataStartRow": 6,
        "supportsMultiRow": False,
        "assetsFolder": "GAS SPLITS",
        "searchSchema": {
            "displayName": "Gas Splits",
            "description": "Three-component split systems with a gas furnace, indoor coil, and outdoor condensing unit. Enter design loads and the page returns models that meet the targets within your tolerance.",
            "targets": [
                {"label": "Total Cooling Capacity", "col": "H", "unit": "BTU/h",  "defaultTolerance": 10},
                {"label": "Gas Heating Output",     "col": "J", "unit": "BTU/h",  "defaultTolerance": 10},
                {"label": "Indoor Airflow",         "col": "C", "unit": "CFM",    "defaultTolerance": 10},
                {"label": "AFUE",                   "col": "L", "unit": "%",      "defaultTolerance": 5},
                {"label": "Compressor Stages",      "col": "Z", "unit": "stages", "defaultTolerance": 0},
            ],
        },
    },
    "VFD DATA.xlsx": {
        "productType": "VFDs",
        "outputFileName": "vfds.json",
        "headerRows": 3,
        "dataStartRow": 5,
        "supportsMultiRow": False,
        "assetsFolder": "VFDs",
        "searchSchema": {
            "displayName": "VFDs",
            "description": "Variable frequency drives. Engineers typically size VFDs to an exact motor HP and electrical service, so this category uses filters only -- no tolerance-based targets apply.",
            "targets": [],
        },
    },
    "PRICE DIFFUSER DATA.xlsx": {
        "productType": "DIFFUSERS",
        "outputFileName": "diffusers.json",
        "headerRows": 2,
        "dataStartRow": 4,
        "supportsMultiRow": False,
        "assetsFolder": "DIFFUSERS",
        # The diffuser SCHEDULE NOTES tab has TWO columns: col A is the
        # model list the note applies to ("ALL" or a comma-separated
        # list like "SPD, SCD"), col B is the note text. The site uses
        # this mapping to show only the notes that apply to the models
        # actually selected, and to auto-number each schedule row's
        # applicable notes in its Accessories column.
        "notesFormat": "modelmap",
        "searchSchema": {
            "displayName": "Diffusers",
            "description": "Price ceiling diffusers (supply + return). Enter a target airflow and/or use the filters to narrow by model, size, and application.",
            "targets": [
                {"label": "Airflow", "col": "U", "unit": "CFM", "defaultTolerance": 15},
            ],
        },
    },
    "PRICE GRILLE DATA.xlsx": {
        "productType": "GRILLES",
        "outputFileName": "grilles.json",
        "headerRows": 2,
        "dataStartRow": 4,
        "supportsMultiRow": False,
        "assetsFolder": "GRILLES",
        # Same two-column SCHEDULE NOTES mapping as the diffusers (col A
        # is "ALL" or a comma-separated MODEL list, col B is the note).
        "notesFormat": "modelmap",
        # The full grille JSON is ~27 MB and Cloudflare Pages caps files
        # at 25 MiB, so split the selections across two files
        # (grilles.json + grilles-2.json); the site re-joins them.
        "splitParts": 2,
        "searchSchema": {
            "displayName": "Grilles",
            "description": "Price supply, return, and transfer grilles. Enter a target airflow and/or use the filters to narrow by model, size, and application.",
            "targets": [
                {"label": "Airflow", "col": "I", "unit": "CFM", "defaultTolerance": 15},
            ],
        },
    },
}


# -----------------------------------------------------------------------------
# MULTI POSITION SPLIT CAPACITY TABLES
# -----------------------------------------------------------------------------
# A separate workbook (one tab per outdoor-condenser + air-handler matchup,
# tab name "<ODU> - <AHU>") that the site uses to drive the cooling +
# heat-pump capacity dropdowns on the Multi Position Split schedule. Each
# tab holds:
#   - a cooling table (cols A-F) in "long" form: every combination of
#     EAT-DB(A) / OA-cooling(B) / Airflow(C) / EAT-WB(D) has several rows
#     keyed by a VALUE type in col E, with the number in col F (RESULT).
#     We keep only MBh (total), S/T (sensible ratio) and the delta-T row
#     and ignore everything else (kW, Amps, Hi/Lo PR, etc.).
#   - an optional heat-pump table (cols H-I): outdoor ambient -> capacity
#     (MBH). Cooling-only systems omit it.
# A combination whose RESULT is "-" (or that is absent entirely) is
# invalid; we simply leave it out of the lookup, so the site only ever
# offers valid combinations in the dropdowns.
# -----------------------------------------------------------------------------

CAPACITY_FILE = "Multi Position Split Capacity Tables.xlsx"
CAPACITY_OUTPUT = "multi_position_split_capacity.json"
# Only these VALUE types (col E) feed the schedule; everything else is junk.
CAPACITY_VALUE_TYPES = ("MBh", "S/T", "∆T")  # ∆ == the delta sign


def _num_key(v):
    """Stringify a numeric cell for use as a JSON lookup key (e.g. 70.0 ->
    '70', -5 -> '-5'), so keys built here match String(value) on the site."""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v)


def convert_capacity_tables(input_path, output_path):
    """Convert the capacity-tables workbook to a JSON keyed by matchup.

    Output shape:
      {
        "matchups": {
          "<ODU> - <AHU>": {
            "axes":    {"eatDb":[...], "eatWb":[...], "oaCooling":[...], "airflow":[...]},
            "cooling": {"<eatDb>|<eatWb>|<oaCooling>|<airflow>": {"ct":N,"cs":N,"lat":N}, ...},
            "hpAxis":  [65, 60, ... -5],     # only when a heat-pump table exists
            "hp":      {"47": 17400, ...}    # outdoor ambient -> total cap (BTU/h)
          }, ...
        }
      }
    Only VALID cooling combos are emitted (invalid/"-"/missing are omitted),
    so the site can constrain its dropdowns to valid combinations.
    """
    print(f"\nConverting: {os.path.basename(input_path)}")
    wb = openpyxl.load_workbook(input_path, data_only=True)

    matchups = {}
    skipped_tabs = []
    for sheet_name in wb.sheetnames:
        name = sheet_name.strip()
        if " - " not in name:
            skipped_tabs.append(sheet_name)
            continue
        ws = wb[sheet_name]

        combos = {}        # (db, wb, oa, cfm) -> {"MBh":.., "S/T":.., delta:..}
        axes = {"eatDb": set(), "eatWb": set(), "oaCooling": set(), "airflow": set()}
        hp = {}

        for r in range(2, ws.max_row + 1):
            # Cooling table (A-F)
            etype = ws.cell(row=r, column=5).value
            if etype is not None and str(etype).strip() in CAPACITY_VALUE_TYPES:
                db = ws.cell(row=r, column=1).value
                oa = ws.cell(row=r, column=2).value
                cfm = ws.cell(row=r, column=3).value
                wbv = ws.cell(row=r, column=4).value
                if None not in (db, oa, cfm, wbv):
                    combos.setdefault((db, oa, cfm, wbv), {})[str(etype).strip()] = \
                        ws.cell(row=r, column=6).value
                    axes["eatDb"].add(db)
                    axes["oaCooling"].add(oa)
                    axes["airflow"].add(cfm)
                    axes["eatWb"].add(wbv)
            # Heat-pump table (H-I)
            amb = ws.cell(row=r, column=8).value
            cap = ws.cell(row=r, column=9).value
            if isinstance(amb, (int, float)) and isinstance(cap, (int, float)):
                hp[_num_key(amb)] = int(round(cap * 1000))

        # Keep only fully-valid cooling combos.
        cooling = {}
        for (db, oa, cfm, wbv), vals in combos.items():
            mbh = vals.get("MBh")
            st = vals.get("S/T")
            dt = vals.get("∆T")
            if not all(isinstance(x, (int, float)) for x in (mbh, st, dt)):
                continue  # invalid ("-") or incomplete -> omit
            key = f"{_num_key(db)}|{_num_key(wbv)}|{_num_key(oa)}|{_num_key(cfm)}"
            ct = int(round(mbh * 1000))
            # Sensible: round the MBH product to 3 decimals, then x1000.
            cs = int(round(round(mbh * st, 3) * 1000))
            lat_raw = db - dt
            lat = int(lat_raw) if float(lat_raw).is_integer() else round(lat_raw, 2)
            # Stored as a compact [total, sensible, LAT] triple (see _meta).
            cooling[key] = [ct, cs, lat]

        entry = {
            "axes": {k: sorted(v) for k, v in axes.items()},
            "cooling": cooling,
        }
        if hp:
            entry["hpAxis"] = sorted(hp.keys(), key=lambda x: float(x), reverse=True)
            entry["hp"] = hp
        matchups[name] = entry

    payload = {
        "matchups": matchups,
        "_meta": {
            "sourceFile":    os.path.basename(input_path),
            "generatedAt":   datetime.now().isoformat(timespec="seconds"),
            "matchupCount":  len(matchups),
            "coolingKey":    "eatDb|eatWb|oaCooling|airflow",
            "coolingValue":  "[total BTU/h, sensible BTU/h, LAT degF]",
            "hp":            "outdoor ambient (degF) -> heat-pump total BTU/h",
        },
    }
    # Pure lookup data (not hand-edited) - written compact to keep the
    # file the site fetches small.
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)

    hp_count = sum(1 for m in matchups.values() if "hp" in m)
    print(f"  -> {len(matchups)} matchups written to {os.path.basename(output_path)} "
          f"({hp_count} with a heat-pump table)")
    if skipped_tabs:
        print(f"     (skipped {len(skipped_tabs)} non-matchup tab(s): "
              f"{', '.join(skipped_tabs)})")


# -----------------------------------------------------------------------------
# DOCUMENTATION COLUMN -> FOLDER / EXTENSION MAP
# -----------------------------------------------------------------------------
# Maps the column-name prefix (e.g. "SUBMITTAL (SYSTEM)" -> "SUBMITTAL") to
# the ASSETS subfolder name and the file extension used for that doc type.
#
# Every product's ASSETS folder has this same flat structure of 8
# sub-folders, so the same map applies to every product:
#
#   HHpro\ASSETS\<product>\SUBMITTALS\           (.pdf)
#   HHpro\ASSETS\<product>\ENGINEERING MANUALS\  (.pdf)
#   HHpro\ASSETS\<product>\CAPACITY TABLES\      (.pdf)
#   HHpro\ASSETS\<product>\INSTALLATION MANUALS\ (.pdf)
#   HHpro\ASSETS\<product>\REVIT\                (.zip)
#   HHpro\ASSETS\<product>\CAD\                  (.zip)
#   HHpro\ASSETS\<product>\CONTROLS\             (.pdf)
#   HHpro\ASSETS\<product>\OPERATION MANUAL\     (.pdf)
#
# Order matters: longer / more specific prefixes must come BEFORE shorter
# ones so that e.g. "OPERATION MANUAL" is matched before any hypothetical
# shorter prefix.
# -----------------------------------------------------------------------------

DOC_COLUMN_MAP = [
    ("ENGINEERING MANUAL",  {"folder": "ENGINEERING MANUALS",  "fileExtension": "pdf"}),
    ("INSTALLATION MANUAL", {"folder": "INSTALLATION MANUALS", "fileExtension": "pdf"}),
    ("OPERATION MANUAL",    {"folder": "OPERATION MANUAL",     "fileExtension": "pdf"}),
    ("CAPACITY TABLE",      {"folder": "CAPACITY TABLES",      "fileExtension": "pdf"}),
    ("CONTROLS OPTIONS",    {"folder": "CONTROLS",             "fileExtension": "pdf"}),
    ("SUBMITTAL",           {"folder": "SUBMITTALS",           "fileExtension": "pdf"}),
    ("REVIT",               {"folder": "REVIT",                "fileExtension": "zip"}),
    ("CAD",                 {"folder": "CAD",                  "fileExtension": "zip"}),
]


def resolve_doc_folder(column_name):
    """Map a documentation column name (e.g. "SUBMITTAL (SYSTEM)") to its
    target folder and file extension via DOC_COLUMN_MAP.

    Returns a dict {folder, fileExtension}. If nothing matches, returns a
    dict with a generic guess and prints a warning (so a new-but-unmapped
    column gets noticed rather than silently dropped).
    """
    upper = (column_name or "").strip().upper()
    for prefix, info in DOC_COLUMN_MAP:
        if upper.startswith(prefix):
            return {"folder": info["folder"], "fileExtension": info["fileExtension"]}

    # Unknown column - synthesize a folder name from the column itself so
    # the JSON still produces a reachable URL, and flag it to the user.
    fallback = re.sub(r"\s*\([^)]*\)\s*", "", column_name or "").strip().upper()
    print(f"  WARNING: Documentation column '{column_name}' doesn't match "
          f"any prefix in DOC_COLUMN_MAP. Using '{fallback}' as the folder; "
          f"add an entry to DOC_COLUMN_MAP if this is a new doc type.")
    return {"folder": fallback or "UNKNOWN", "fileExtension": "pdf"}


# -----------------------------------------------------------------------------
# HELPERS
# -----------------------------------------------------------------------------

def clean_value(val):
    """Normalize a cell value for JSON output."""
    if val is None:
        return None
    if isinstance(val, str):
        v = val.strip()
        if v == "":
            return None
        return v
    if isinstance(val, float):
        # Round to drop float noise like 15.965000000000001 while keeping
        # precision when it's meaningful.
        if val.is_integer():
            return int(val)
        return round(val, 6)
    if isinstance(val, datetime):
        return val.isoformat()
    return val


def find_row1_sections(ws):
    """
    Find the row-1 merged sections and return their column ranges as
    1-based (start, end) tuples.

    Required sections (every product file must have these):
      SCHEDULE RANGE, FILTERS, DOCUMENTATION

    Optional sections (only on products that need them):
      REFRIGERANT CALCULATIONS  - mini-splits / multi-position splits
                                  for the line-set + charge calculator
                                  on the project view.
    """
    REQUIRED = ("SCHEDULE RANGE", "FILTERS", "DOCUMENTATION")
    OPTIONAL = ("REFRIGERANT CALCULATIONS",)
    KNOWN = REQUIRED + OPTIONAL

    sections = {}
    for mr in ws.merged_cells.ranges:
        if mr.min_row == 1 and mr.max_row == 1:
            label = clean_value(ws.cell(row=1, column=mr.min_col).value)
            if label in KNOWN:
                sections[label] = (mr.min_col, mr.max_col)

    missing = [k for k in REQUIRED if k not in sections]
    if missing:
        raise ValueError(
            "Row 1 is missing required merged section(s): " + ", ".join(missing) +
            ". Each of SCHEDULE RANGE, FILTERS, DOCUMENTATION must be a "
            "single merged cell in row 1 spanning its columns."
        )
    return sections


def merge_lookup(ws):
    """Build a (row, col) -> MergedCellRange map for the whole sheet plus
    a set of anchor (row, col) pairs (top-left of each merge).

    Lets us ask in O(1):
      - "is this cell covered by a merge?"
      - "is this cell the anchor of a merge?"
    """
    cell_to_merge = {}
    anchors = set()
    for mr in ws.merged_cells.ranges:
        anchors.add((mr.min_row, mr.min_col))
        for r in range(mr.min_row, mr.max_row + 1):
            for c in range(mr.min_col, mr.max_col + 1):
                cell_to_merge[(r, c)] = mr
    return cell_to_merge, anchors


def extract_schedule_header(ws, schedule_cols, header_rows, cell_to_merge, anchors):
    """Read the schedule header rows (rows 2 .. 2+header_rows-1) inside the
    schedule range, preserving any horizontal and vertical merges.

    Returns a list (one element per header row) of lists of
    {col, value, colspan, rowspan} dicts. Only the anchor cell of a merge
    is emitted; cells covered by a merge are skipped.
    """
    min_col, max_col = schedule_cols
    rows_out = []
    for r in range(2, 2 + header_rows):
        row_cells = []
        for c in range(min_col, max_col + 1):
            mr = cell_to_merge.get((r, c))
            if mr is not None and (r, c) != (mr.min_row, mr.min_col):
                continue  # covered by a merge, not the anchor

            val = clean_value(ws.cell(row=r, column=c).value)
            colspan = 1
            rowspan = 1
            if mr is not None:
                colspan = mr.max_col - mr.min_col + 1
                rowspan = mr.max_row - mr.min_row + 1

            row_cells.append({
                "col":     get_column_letter(c),
                "value":   val,
                "colspan": colspan,
                "rowspan": rowspan,
            })
        rows_out.append(row_cells)
    return rows_out


def extract_filter_columns(ws, filter_cols):
    """Read the FILTER columns' names from row 2."""
    min_col, max_col = filter_cols
    out = []
    for c in range(min_col, max_col + 1):
        name = clean_value(ws.cell(row=2, column=c).value)
        if name:
            out.append({"name": name, "col": get_column_letter(c)})
    return out


def extract_doc_columns(ws, doc_cols):
    """Read the DOCUMENTATION columns' names from row 2 and map each one
    to its ASSETS sub-folder + file extension via DOC_COLUMN_MAP.
    """
    min_col, max_col = doc_cols
    docs = []
    for c in range(min_col, max_col + 1):
        name = clean_value(ws.cell(row=2, column=c).value)
        if not name:
            continue
        mapping = resolve_doc_folder(name)
        docs.append({
            "name":          name,
            "col":           get_column_letter(c),
            "folder":        mapping["folder"],
            "fileExtension": mapping["fileExtension"],
        })
    return docs


def extract_refrigerant_columns(ws, refrigerant_cols):
    """Read the REFRIGERANT CALCULATIONS columns' header names from row 2.

    Headers in this section follow the same row-2 convention used by
    FILTERS and DOCUMENTATION: each column has a single cell on row 2
    containing the full label (newlines inside the label are flattened
    so the JSON name is a single line).
    """
    min_col, max_col = refrigerant_cols
    out = []
    for c in range(min_col, max_col + 1):
        name = clean_value(ws.cell(row=2, column=c).value)
        if not name:
            continue
        # Excel cells can hold a soft-wrapped label like "MAX VERTICAL\nSEPARATION\n(ODU TO IDU)\n(FT)";
        # squash any embedded newlines + collapse whitespace so the JSON name
        # reads cleanly in the site UI.
        flat = re.sub(r"\s+", " ", str(name)).strip()
        out.append({"name": flat, "col": get_column_letter(c)})
    return out


def find_last_data_row(ws, data_start_row, schedule_cols):
    """
    Scan down from data_start_row and return the last row with any value
    in the schedule range. Trims trailing empty rows (some files pad to
    row 1,048,570).
    """
    min_col, max_col = schedule_cols
    last = data_start_row - 1
    empty_streak = 0
    row = data_start_row
    while row <= ws.max_row:
        has_value = False
        for c in range(min_col, max_col + 1):
            if ws.cell(row=row, column=c).value not in (None, ""):
                has_value = True
                break
        if has_value:
            last = row
            empty_streak = 0
        else:
            empty_streak += 1
            # Safety: stop after 20 consecutive empty rows
            if empty_streak >= 20:
                break
        row += 1
    return last


def build_groups(ws, data_start_row, data_end_row, schedule_cols,
                 supports_multi_row, cell_to_merge):
    """Group consecutive data rows into selections.

    For products without multi-row selections, each data row is its own
    group. For multi-row products, rows linked by a multi-row merge in
    the schedule range are joined into one group.
    """
    if not supports_multi_row:
        return [(r, r) for r in range(data_start_row, data_end_row + 1)]

    min_col, max_col = schedule_cols
    row_groups = {r: [r, r] for r in range(data_start_row, data_end_row + 1)}

    for mr in ws.merged_cells.ranges:
        if mr.min_col < min_col or mr.max_col > max_col:
            continue
        if mr.min_row < data_start_row or mr.max_row > data_end_row:
            continue
        if mr.max_row == mr.min_row:
            continue
        for r in range(mr.min_row, mr.max_row + 1):
            bounds = row_groups[r]
            bounds[0] = min(bounds[0], mr.min_row)
            bounds[1] = max(bounds[1], mr.max_row)

    groups = []
    r = data_start_row
    while r <= data_end_row:
        lo, hi = row_groups[r]
        changed = True
        while changed:
            changed = False
            for rr in range(lo, hi + 1):
                b = row_groups[rr]
                if b[0] < lo:
                    lo = b[0]; changed = True
                if b[1] > hi:
                    hi = b[1]; changed = True
        groups.append((lo, hi))
        r = hi + 1
    return groups


def row_data_for_range(ws, row, col_start, col_end):
    """Read one row of data between col_start and col_end. Keys are
    column letters; only cells with a value are included."""
    data = {}
    for c in range(col_start, col_end + 1):
        val = clean_value(ws.cell(row=row, column=c).value)
        if val is None:
            continue
        data[get_column_letter(c)] = val
    return data


def row_data_for_range_by_name(ws, row, columns_meta):
    """Same as row_data_for_range but keyed by the column's display name
    instead of its letter. Used for filterData and documentationData."""
    out = {}
    for meta in columns_meta:
        c = column_index_from_string(meta["col"])
        val = clean_value(ws.cell(row=row, column=c).value)
        if val is None:
            continue
        out[meta["name"]] = val
    return out


def row_horizontal_spans(cell_to_merge, row, col_start, col_end):
    """Find horizontal (colspan > 1) merges on a single data row within
    the schedule range. Returns {anchor_col_letter: colspan}.

    Example: on a Mini Splits row where J:L is merged (Voltage/MCA/MOP)
    with "Indoor Powered From Outdoor Unit", returns {"J": 3}.

    Vertical-only merges (rowspan > 1, colspan == 1) are ignored - those
    are already handled by the row-group logic that builds multi-row
    selections.
    """
    spans = {}
    seen_merges = set()
    for c in range(col_start, col_end + 1):
        mr = cell_to_merge.get((row, c))
        if mr is None:
            continue
        if id(mr) in seen_merges:
            continue
        seen_merges.add(id(mr))
        colspan = mr.max_col - mr.min_col + 1
        if colspan <= 1:
            continue
        if mr.min_col < col_start or mr.max_col > col_end:
            continue
        if mr.min_row != row:
            continue
        spans[get_column_letter(mr.min_col)] = colspan
    return spans


def extract_selections(ws, groups, schedule_cols, filter_cols, doc_cols,
                       filter_columns_meta, doc_columns_meta, cell_to_merge,
                       refrigerant_columns_meta=None):
    """Build the selections list from the grouped row ranges.

    `refrigerant_columns_meta` is optional (only present on Mini Splits
    and Multi Position Splits today). When provided, each row gets a
    `refrigerantData` field keyed by the column's display name -- same
    shape as filterData / documentationData.
    """
    selections = []
    for i, (lo, hi) in enumerate(groups, start=1):
        sel_id = f"sel_{i:04d}"
        rows_out = []
        for r in range(lo, hi + 1):
            row_entry = {
                "scheduleData":      row_data_for_range(ws, r, schedule_cols[0], schedule_cols[1]),
                "filterData":        row_data_for_range_by_name(ws, r, filter_columns_meta),
                "documentationData": row_data_for_range_by_name(ws, r, doc_columns_meta),
            }
            if refrigerant_columns_meta:
                row_entry["refrigerantData"] = row_data_for_range_by_name(
                    ws, r, refrigerant_columns_meta
                )
            spans = row_horizontal_spans(cell_to_merge, r, schedule_cols[0], schedule_cols[1])
            if spans:
                row_entry["scheduleCellSpans"] = spans
            rows_out.append(row_entry)
        selections.append({"id": sel_id, "rows": rows_out})
    return selections


# -----------------------------------------------------------------------------
# SCHEDULE NOTES
# -----------------------------------------------------------------------------

def extract_schedule_notes(wb, notes_format=None):
    """Read the SCHEDULE NOTES tab and return a structured notes object.

    `notes_format` comes from the product config:
      "modelmap"  - two-column layout (col A = model list or "ALL",
                    col B = note text). Used by DIFFUSERS.
      None        - auto-detect: the Marvair three-section layout is
                    recognized by cell A1 starting with 'STANDARD
                    OPTIONS'; otherwise a flat one-note-per-row list.

    Output shape:
      {"format": "list",     "notes": [...]}
      {"format": "modelmap", "notes": [{"models": [...], "text": ...}, ...]}
      {"format": "marvair",  "standard": [...], "configuration": [...],
                             "optional":  [{"text": ..., "sub": [...]}, ...]}
    """
    if "SCHEDULE NOTES" not in wb.sheetnames:
        return {"format": "list", "notes": []}
    ws = wb["SCHEDULE NOTES"]

    if notes_format == "modelmap":
        return _parse_modelmap_notes(ws)

    a1 = ws.cell(row=1, column=1).value
    a1_str = str(a1).strip().upper() if a1 is not None else ""
    if a1_str.startswith("STANDARD OPTIONS"):
        return _parse_marvair_notes(ws)
    return _parse_simple_notes(ws)


def _parse_modelmap_notes(ws):
    """Parse the two-column model-mapped SCHEDULE NOTES layout.

    Col A: "ALL" or a comma-separated model list ("SPD, SCD, SCDA").
    Col B: the note text. Rows missing either cell are skipped.
    Note order in the sheet is preserved - it drives the numbering
    on the site.
    """
    notes = []
    for r in range(1, ws.max_row + 1):
        models_raw = clean_value(ws.cell(row=r, column=1).value)
        text = clean_value(ws.cell(row=r, column=2).value)
        if not models_raw or not text:
            continue
        models = [m.strip() for m in str(models_raw).split(",") if m.strip()]
        notes.append({"models": models, "text": str(text)})
    return {"format": "modelmap", "notes": notes}


def _parse_simple_notes(ws):
    """Read notes from column A of the SCHEDULE NOTES tab, one per row.
    Blank rows are skipped."""
    notes = []
    for r in range(1, ws.max_row + 1):
        val = clean_value(ws.cell(row=r, column=1).value)
        if val:
            notes.append(str(val))
    return {"format": "list", "notes": notes}


def _parse_marvair_notes(ws):
    """Parse the three-section Marvair SCHEDULE NOTES layout.

    Expected structure:
      Row 1:      A = 'STANDARD OPTIONS/ACCESSORIES:'
      Rows 2..N:  Left notes   - A = '1-' / B = text
                  Right notes  - on the same rows, some further column
                                  has 'N-' followed by text
      Row M:      A = 'OPTIONAL ACCESSORIES:'
      Some row:   some column has 'CONFIGURATION:'
      Below OPTIONAL:
        - Main notes:  A = 'N-' / B = text
        - Sub-notes:   B = '-' / C = text (tied to the main note above)
      Below CONFIGURATION: numbered notes in config_col / config_col+1.
    """
    standard = []
    configuration = []
    optional = []

    # Locate the three section markers
    standard_row = None
    optional_row = None
    config_row = None
    config_col = None

    for r in range(1, ws.max_row + 1):
        a_raw = ws.cell(row=r, column=1).value
        if a_raw is not None:
            a_upper = str(a_raw).strip().upper()
            if standard_row is None and a_upper.startswith("STANDARD OPTIONS"):
                standard_row = r
            elif optional_row is None and a_upper.startswith("OPTIONAL ACCESSORIES"):
                optional_row = r
        if config_row is None:
            max_scan = min(ws.max_column + 1, 30)
            for c in range(1, max_scan):
                val = ws.cell(row=r, column=c).value
                if val is None:
                    continue
                v = str(val).strip().upper()
                if v == "CONFIGURATION:" or v.startswith("CONFIGURATION:"):
                    config_row = r
                    config_col = c
                    break

    # STANDARD: left column first, then right column, so output order is
    # 1..14 rather than interleaved.
    std_start = (standard_row + 1) if standard_row else 1
    std_end = (optional_row - 1) if optional_row else ws.max_row

    for r in range(std_start, std_end + 1):
        b = ws.cell(row=r, column=2).value
        if b is not None and str(b).strip():
            standard.append(str(b).strip())

    for r in range(std_start, std_end + 1):
        for c in range(3, min(ws.max_column + 1, 20)):
            val = ws.cell(row=r, column=c).value
            if val is None:
                continue
            if re.match(r"^\d+-$", str(val).strip()):
                text_cell = ws.cell(row=r, column=c + 1).value
                if text_cell is not None and str(text_cell).strip():
                    standard.append(str(text_cell).strip())
                break

    # CONFIGURATION
    if config_row is not None and config_col is not None:
        for r in range(config_row + 1, ws.max_row + 1):
            num = ws.cell(row=r, column=config_col).value
            if num is None:
                continue
            if not re.match(r"^\d+-$", str(num).strip()):
                break
            text = ws.cell(row=r, column=config_col + 1).value
            if text is not None and str(text).strip():
                configuration.append(str(text).strip())

    # OPTIONAL
    if optional_row is not None:
        current_parent = None
        for r in range(optional_row + 1, ws.max_row + 1):
            a = ws.cell(row=r, column=1).value
            b = ws.cell(row=r, column=2).value
            c = ws.cell(row=r, column=3).value

            if a is not None and re.match(r"^\d+-$", str(a).strip()):
                text = str(b).strip() if (b is not None and str(b).strip()) else ""
                current_parent = {"text": text, "sub": []}
                optional.append(current_parent)
            elif (b is not None and str(b).strip() == "-"
                    and c is not None and str(c).strip()):
                if current_parent is not None:
                    current_parent["sub"].append(str(c).strip())

    return {
        "format":        "marvair",
        "standard":      standard,
        "configuration": configuration,
        "optional":      optional,
    }


# -----------------------------------------------------------------------------
# MAIN CONVERSION
# -----------------------------------------------------------------------------

def convert_file(input_path, config, output_path):
    """Convert a single Excel file to JSON using the given config."""
    print(f"\nConverting: {os.path.basename(input_path)}")
    wb = openpyxl.load_workbook(input_path, data_only=True)

    if "SCHEDULE" not in wb.sheetnames:
        raise ValueError(f"'{os.path.basename(input_path)}' has no SCHEDULE tab.")
    ws = wb["SCHEDULE"]

    sections = find_row1_sections(ws)
    schedule_cols = sections["SCHEDULE RANGE"]
    filter_cols = sections["FILTERS"]
    doc_cols = sections["DOCUMENTATION"]
    refrigerant_cols = sections.get("REFRIGERANT CALCULATIONS")  # optional

    cell_to_merge, anchors = merge_lookup(ws)

    schedule_title = clean_value(ws.cell(row=2, column=schedule_cols[0]).value)

    schedule_header_rows = extract_schedule_header(
        ws, schedule_cols, config["headerRows"], cell_to_merge, anchors
    )
    filter_columns = extract_filter_columns(ws, filter_cols)
    doc_columns = extract_doc_columns(ws, doc_cols)
    refrigerant_columns = (
        extract_refrigerant_columns(ws, refrigerant_cols)
        if refrigerant_cols else []
    )

    data_end_row = find_last_data_row(ws, config["dataStartRow"], schedule_cols)
    groups = build_groups(
        ws, config["dataStartRow"], data_end_row, schedule_cols,
        config["supportsMultiRow"], cell_to_merge,
    )
    selections = extract_selections(
        ws, groups, schedule_cols, filter_cols, doc_cols,
        filter_columns, doc_columns, cell_to_merge,
        refrigerant_columns_meta=refrigerant_columns or None,
    )

    schedule_notes = extract_schedule_notes(wb, config.get("notesFormat"))

    schedule_col_letters = [
        get_column_letter(c) for c in range(schedule_cols[0], schedule_cols[1] + 1)
    ]

    payload = {
        "productType":               config["productType"],
        "assetsFolder":              config.get("assetsFolder"),
        "scheduleTitle":             schedule_title,
        "supportsMultiRowSelections": config["supportsMultiRow"],
        # searchSchema feeds the Design Search page on the site
        # (numeric "design target" inputs + filter dropdowns derived
        # from filterColumns). Required by every product config; pass
        # an empty targets list for products that need filters only.
        "searchSchema":              config["searchSchema"],
        "scheduleHeader": {
            "columnLetters": schedule_col_letters,
            "rows":          schedule_header_rows,
        },
        "filterColumns":        filter_columns,
        "documentationColumns": doc_columns,
        # refrigerantColumns is the schema (display name + Excel column
        # letter) for every column in the optional REFRIGERANT
        # CALCULATIONS section. The site reads it on the project view's
        # "Refrigerant" tab to drive the line-set + charge calculator.
        # Empty list when the product file doesn't have that section.
        "refrigerantColumns":   refrigerant_columns,
        "selections":           selections,
        "scheduleNotes":        schedule_notes,
        "_meta": {
            "sourceFile":    os.path.basename(input_path),
            "generatedAt":   datetime.now().isoformat(timespec="seconds"),
            "dataRowCount":  data_end_row - config["dataStartRow"] + 1,
            "selectionCount": len(selections),
        },
    }

    # Cloudflare Pages rejects any single file over 25 MiB. Products
    # whose JSON would exceed that (grilles: 32k+ selections) set
    # "splitParts" in PRODUCT_CONFIGS: the selections array is split
    # into that many contiguous chunks. The main file keeps everything
    # else (header, filters, docs, notes, searchSchema) plus chunk 1
    # and lists the continuation files in "continuationFiles"; each
    # continuation file holds only its chunk of selections. The site
    # (JS/data.js loadProduct) fetches the continuations and re-joins
    # the selections transparently.
    parts = int(config.get("splitParts") or 1)
    if parts > 1:
        stem, ext = os.path.splitext(output_path)
        chunk_size = (len(selections) + parts - 1) // parts
        chunks = [selections[i:i + chunk_size]
                  for i in range(0, len(selections), chunk_size)]
        cont_names = [f"{os.path.basename(stem)}-{i + 2}{ext}"
                      for i in range(len(chunks) - 1)]
        payload["selections"] = chunks[0]
        payload["continuationFiles"] = cont_names
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        for name, chunk in zip(cont_names, chunks[1:]):
            part_path = os.path.join(os.path.dirname(output_path), name)
            with open(part_path, "w", encoding="utf-8") as f:
                json.dump({"selections": chunk}, f, indent=2, ensure_ascii=False)
        sizes = ", ".join(
            f"{os.path.basename(p)} ({os.path.getsize(p) / 1048576:.1f} MiB)"
            for p in [output_path] + [
                os.path.join(os.path.dirname(output_path), n) for n in cont_names]
        )
        print(f"  -> {len(selections)} selections written across "
              f"{len(chunks)} files: {sizes}")
        return

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"  -> {len(selections)} selections written to "
          f"{os.path.basename(output_path)}")
    if config["supportsMultiRow"]:
        multi = sum(1 for s in selections if len(s["rows"]) > 1)
        print(f"     ({multi} multi-row selections, "
              f"{len(selections) - multi} single-row selections)")


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.abspath(os.path.join(script_dir, "..", "JSON"))
    os.makedirs(output_dir, exist_ok=True)

    print(f"Input folder : {script_dir}")
    print(f"Output folder: {output_dir}")

    converted = 0
    skipped = []
    for fname in sorted(os.listdir(script_dir)):
        if not fname.lower().endswith(".xlsx"):
            continue
        if fname.startswith("~$"):  # Excel lock files
            continue
        if fname == CAPACITY_FILE:
            try:
                convert_capacity_tables(
                    os.path.join(script_dir, fname),
                    os.path.join(output_dir, CAPACITY_OUTPUT),
                )
                converted += 1
            except Exception as e:
                print(f"  ERROR processing {fname}: {e}")
            continue
        if fname not in PRODUCT_CONFIGS:
            skipped.append(fname)
            continue
        config = PRODUCT_CONFIGS[fname]
        input_path = os.path.join(script_dir, fname)
        output_path = os.path.join(output_dir, config["outputFileName"])
        try:
            convert_file(input_path, config, output_path)
            converted += 1
        except Exception as e:
            print(f"  ERROR processing {fname}: {e}")

    print(f"\nDone. Converted {converted} file(s).")
    if skipped:
        print("Skipped (no config entry in PRODUCT_CONFIGS):")
        for f in skipped:
            print(f"  - {f}")
        print("Add an entry to PRODUCT_CONFIGS to include these files.")

    print("\nTip: run validate_files.py in this folder to check whether "
          "the filenames referenced in the generated JSONs actually exist "
          "in your ASSETS folders.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print("\nScript stopped due to an unexpected error:")
        traceback.print_exc()
    finally:
        try:
            input("\nPress Enter to close this window...")
        except EOFError:
            pass