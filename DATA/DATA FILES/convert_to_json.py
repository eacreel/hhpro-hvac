r"""
HHpro - Excel to JSON Converter
================================

Converts product data Excel files in this folder to JSON files that the HHpro
website uses to populate the mechanical schedules, filters, and documentation
for each product type.

Location (in the site's folder structure):
    HHpro\DATA\DATA FILES\convert_to_json.py

How it runs:
    1. Looks for every .xlsx file in the folder this script lives in.
    2. Matches each file against the PRODUCT_CONFIGS dictionary below.
    3. Reads the SCHEDULE tab and SCHEDULE NOTES tab from each matched file.
    4. Writes a .json file (same base name) into ..\JSON\ (i.e. HHpro\DATA\JSON\).

How to add a new product type:
    1. Drop the new .xlsx file into HHpro\DATA\DATA FILES\.
    2. Add one entry to PRODUCT_CONFIGS below. The only required values are the
       product type name, the number of schedule-header rows, and the row where
       the data starts. Everything else is auto-detected from the merged cells
       in row 1 ("SCHEDULE RANGE", "FILTERS", "DOCUMENTATION").
    3. Run this script.

Excel file structure (expected in every data file):
    Tab 1 - "SCHEDULE":
        Row 1 must contain three merged-cell ranges labeled exactly:
            "SCHEDULE RANGE"  - spans the schedule data columns
            "FILTERS"         - spans the filter columns (separated by a gap)
            "DOCUMENTATION"   - spans the documentation columns (separated by a gap)
        Rows below row 1 are schedule headers (variable count per product, set
            in the config below under "headerRows" and "dataStartRow").
        Each row of data is either ONE selection (most products) or PART of a
            selection (mini-split multi-indoor systems, where multiple rows are
            grouped together via merged cells in the outdoor-unit columns).
    Tab 2 - "SCHEDULE NOTES":
        Column A holds any available schedule notes, starting at A1. Can be empty.
"""

import json
import os
import re
import sys
from datetime import datetime
from difflib import get_close_matches

import openpyxl
from openpyxl.utils import get_column_letter, column_index_from_string


# -----------------------------------------------------------------------------
# PRODUCT CONFIGS
# -----------------------------------------------------------------------------
# To add a new product type, add a new entry to this dict.
# The key is the input Excel filename (must match exactly, case-sensitive).
#
# Fields:
#   productType        - Human-readable product type name (matches the tab name
#                        shown on the site's front page)
#   outputFileName     - Name of the JSON file to write (without folder path)
#   headerRows         - Number of header rows below row 1 but above the data.
#                        Example: GAS_PACKS has schedule title in row 2 and
#                        column headers in rows 3-4, so headerRows = 3.
#   dataStartRow       - 1-based row number where the first data row begins.
#   supportsMultiRow   - True if one selection can span multiple rows
#                        (detected via merged cells). Currently only mini-splits.
#   assetsFolder       - Name of this product's folder under HHpro/ASSETS/.
#                        The script scans this folder for sub-directories (one
#                        per doc type) and uses the ACTUAL folder names it
#                        finds there - so if you name a folder "ENGINEERING
#                        MANUAL" instead of "ENGINEERING MANUALS", the site
#                        will use your name. Falls back to DOC_FOLDER_MAP
#                        below if the ASSETS folder can't be located.
# -----------------------------------------------------------------------------

PRODUCT_CONFIGS = {
    "GAS PACKS DATA.xlsx": {
        "productType": "GAS PACK RTUS",
        "outputFileName": "gas_packs.json",
        "headerRows": 3,
        "dataStartRow": 5,
        "supportsMultiRow": False,
        "assetsFolder": "GAS PACKS",
    },
    "MARVAIR DATA.xlsx": {
        "productType": "MARVAIR VERTICAL WALL MOUNT",
        "outputFileName": "marvair.json",
        "headerRows": 2,
        "dataStartRow": 4,
        "supportsMultiRow": False,
        "assetsFolder": "MARVAIR",
    },
    "MINI SPLIT DATA.xlsx": {
        "productType": "MINI SPLITS",
        "outputFileName": "mini_splits.json",
        "headerRows": 5,
        "dataStartRow": 7,
        "supportsMultiRow": True,
        "assetsFolder": "MINI SPLITS",
    },
    "MULTI POSITION SPLIT DATA.xlsx": {
        "productType": "MULTI POSITION SPLITS",
        "outputFileName": "multi_position_splits.json",
        "headerRows": 4,
        "dataStartRow": 6,
        "supportsMultiRow": False,
        "assetsFolder": "MULTI POSITION SPLITS",
    },
}


# -----------------------------------------------------------------------------
# DOCUMENTATION FOLDER & EXTENSION MAP
# -----------------------------------------------------------------------------
# Maps the leading keyword in a documentation column name (e.g.
# "SUBMITTAL (OUTDOOR UNIT)" -> "SUBMITTAL") to the ASSETS sub-folder name and
# the file extension for that doc type.
#
# The folder name MUST match the folder name under
#   HHpro\ASSETS\<PRODUCT TYPE>\<folder>\
# so the site can build the correct URL to fetch the file.
#
# If you add a new documentation category (e.g. "WIRING DIAGRAMS") in a future
# data file, add it here too.
# -----------------------------------------------------------------------------

DOC_FOLDER_MAP = [
    # Order matters: longer/more specific prefixes should come first so e.g.
    # "OPERATION MANUAL" wins over any shorter "OPERATION" match.
    ("ENGINEERING MANUAL",  {"folder": "ENGINEERING MANUALS",  "fileExtension": "pdf"}),
    ("INSTALLATION MANUAL", {"folder": "INSTALLATION MANUALS", "fileExtension": "pdf"}),
    ("OPERATION MANUAL",    {"folder": "OPERATION MANUALS",    "fileExtension": "pdf"}),
    ("CAPACITY TABLE",      {"folder": "CAPACITY TABLES",      "fileExtension": "pdf"}),
    ("CONTROLS OPTIONS",    {"folder": "CONTROLS OPTIONS",     "fileExtension": "pdf"}),
    ("SUBMITTAL",           {"folder": "SUBMITTALS",           "fileExtension": "pdf"}),
    ("REVIT",               {"folder": "REVIT",                "fileExtension": "zip"}),
    ("CAD",                 {"folder": "CAD",                  "fileExtension": "zip"}),
]


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
        # Round to a reasonable number of decimal places to avoid float noise
        # like 15.965000000000001, but keep precision when it's meaningful.
        if val.is_integer():
            return int(val)
        return round(val, 6)
    if isinstance(val, datetime):
        return val.isoformat()
    return val


def find_row1_sections(ws):
    """
    Find the three row-1 merged sections ("SCHEDULE RANGE", "FILTERS",
    "DOCUMENTATION") and return their column ranges as 1-based (start, end)
    tuples.
    """
    sections = {}
    for mr in ws.merged_cells.ranges:
        if mr.min_row == 1 and mr.max_row == 1:
            label = clean_value(ws.cell(row=1, column=mr.min_col).value)
            if label in ("SCHEDULE RANGE", "FILTERS", "DOCUMENTATION"):
                sections[label] = (mr.min_col, mr.max_col)

    missing = [k for k in ("SCHEDULE RANGE", "FILTERS", "DOCUMENTATION")
               if k not in sections]
    if missing:
        raise RuntimeError(
            "Row 1 is missing required merged section(s): " + ", ".join(missing) +
            ". Row 1 must have three merged cells labeled 'SCHEDULE RANGE', "
            "'FILTERS', and 'DOCUMENTATION'."
        )
    return sections


def merge_lookup(ws):
    """
    Returns a dict mapping every (row, col) that is part of a merged range to
    the merged range object, and a set of (row, col) tuples that are the
    TOP-LEFT anchor of each merge (where the actual value lives).
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
    """
    Build a 2D grid of header cells that preserves merged-cell spans so the
    site can render the multi-row schedule header correctly.

    schedule_cols: (min_col, max_col) for the schedule range
    header_rows: number of header rows (below row 1, above the data)

    Returns a list of lists; each inner list is one header row of cell dicts:
        {"col": "A", "colspan": 1, "rowspan": 1, "value": "MAKE"}
    Only the anchor cell of each merged range is emitted, so the site can
    render them as table cells with colspan/rowspan directly.
    """
    min_col, max_col = schedule_cols
    # Header rows are rows 2 through (1 + header_rows). Row 1 is the
    # "SCHEDULE RANGE" merged title and is skipped.
    first_header_row = 2
    last_header_row = 1 + header_rows

    result = []
    for r in range(first_header_row, last_header_row + 1):
        row_cells = []
        c = min_col
        while c <= max_col:
            if (r, c) in cell_to_merge:
                mr = cell_to_merge[(r, c)]
                # Only emit a cell at the anchor; non-anchor cells are
                # consumed by the colspan/rowspan of the anchor cell.
                if (r, c) == (mr.min_row, mr.min_col):
                    # Clamp rowspan so it doesn't extend beyond our header rows
                    span_max_row = min(mr.max_row, last_header_row)
                    row_cells.append({
                        "col": get_column_letter(c),
                        "colspan": mr.max_col - mr.min_col + 1,
                        "rowspan": span_max_row - mr.min_row + 1,
                        "value": clean_value(ws.cell(row=r, column=c).value),
                    })
                # Skip past the merge horizontally on this row
                c = mr.max_col + 1
            else:
                row_cells.append({
                    "col": get_column_letter(c),
                    "colspan": 1,
                    "rowspan": 1,
                    "value": clean_value(ws.cell(row=r, column=c).value),
                })
                c += 1
        result.append(row_cells)
    return result


def extract_filter_columns(ws, filter_cols):
    """Read the filter column names from row 2 of the FILTERS section."""
    min_col, max_col = filter_cols
    names = []
    for c in range(min_col, max_col + 1):
        name = clean_value(ws.cell(row=2, column=c).value)
        if name:
            names.append({"name": name, "col": get_column_letter(c)})
    return names


def resolve_doc_folder(doc_name):
    """Given a documentation column name, return its folder/extension info."""
    upper = doc_name.upper()
    for prefix, info in DOC_FOLDER_MAP:
        if upper.startswith(prefix):
            return info
    # Unrecognized doc type - default to PDF in a folder named after the
    # column, so the user can at least see what's happening and fix it.
    return {"folder": doc_name, "fileExtension": "pdf", "_unrecognized": True}


# -----------------------------------------------------------------------------
# Actual-folder matching
# -----------------------------------------------------------------------------
# The DOC_FOLDER_MAP above is a FALLBACK. The real source of truth is the
# folder names the user has actually created under HHpro/ASSETS/<product>/.
# These helpers scan that directory and match doc-column names to the
# folders found there (tolerating plural/singular differences), so the
# generated JSON points to wherever the user's files actually live.
# -----------------------------------------------------------------------------

def find_hhpro_root():
    """Walk up from the script location looking for the HHpro project root.

    We identify the root as the first ancestor directory that contains both
    an 'ASSETS' folder and a 'DATA' folder. Returns None if not found.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    cur = here
    for _ in range(6):  # safety cap
        if os.path.isdir(os.path.join(cur, "ASSETS")) and os.path.isdir(os.path.join(cur, "DATA")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return None


def scan_product_assets(hhpro_root, assets_folder_name):
    """List sub-directory names in <hhpro_root>/ASSETS/<assets_folder_name>/.

    Returns [] if the path doesn't exist. The returned names preserve the
    exact casing / spelling the user used.
    """
    if not hhpro_root or not assets_folder_name:
        return []
    product_path = os.path.join(hhpro_root, "ASSETS", assets_folder_name)
    if not os.path.isdir(product_path):
        return []
    return [
        name for name in os.listdir(product_path)
        if os.path.isdir(os.path.join(product_path, name))
    ]


def _normalize_plural(s):
    """Strip whitespace, uppercase, drop a single trailing S for plural/
    singular insensitive matching. 'ENGINEERING MANUAL' and 'ENGINEERING
    MANUALS' both normalize to 'ENGINEERING MANUAL'."""
    out = (s or "").strip().upper()
    if len(out) > 1 and out.endswith("S"):
        out = out[:-1]
    return out


def match_folder_name(col_name, actual_folders):
    """Find the folder on disk that best matches a documentation column name.

    Column names usually carry a parenthetical qualifier we strip first, e.g.
    'ENGINEERING MANUAL (SYSTEM)' -> 'ENGINEERING MANUAL'. Then we try:
      1. Exact case-insensitive match against an actual folder name
      2. Plural-insensitive match (trailing S stripped on both sides)

    Returns the actual folder name (with its original casing) on match, or
    None if nothing matches.
    """
    base = re.sub(r"\s*\([^)]*\)\s*", "", col_name or "").strip()
    if not base:
        return None

    base_upper = base.upper()
    for folder in actual_folders:
        if folder.strip().upper() == base_upper:
            return folder

    base_norm = _normalize_plural(base)
    for folder in actual_folders:
        if _normalize_plural(folder) == base_norm:
            return folder

    return None


def validate_selection_files(selections, doc_columns, hhpro_root, assets_folder):
    """Verify every file referenced in the selections actually exists on disk.

    This is a diagnostic pass - it doesn't change the generated JSON. Its
    job is to tell the user which of their Excel cell values point to
    filenames that don't exist in the product's ASSETS subfolders, and to
    suggest the closest real filename when there's a near-match (e.g. case
    difference or a small typo).

    Output example:

      File check: 134 unique file(s) referenced, 2 missing
        MISSING [SUBMITTAL (SYSTEM)]: 'MARVAIR MGH DATA SHEET.pdf' in 'SUBMITTALS'
          -> closest real file: 'MGH3090AA.pdf'
        MISSING [INSTALLATION MANUAL (SYSTEM)]: 'OM - CTXV07AVJU9.pdf' in 'INSTALLATION MANUALS'
          -> closest real file: 'IM - CTXV07AVJU9.pdf'

    Returns nothing; prints directly.
    """
    if not hhpro_root or not assets_folder:
        return  # can't validate without a real project root

    product_root = os.path.join(hhpro_root, "ASSETS", assets_folder)
    if not os.path.isdir(product_root):
        return

    # Map column name -> doc column metadata for quick lookup
    col_meta = {dc["name"]: dc for dc in doc_columns}

    # Collect every unique (folder, filename) pair referenced across all
    # selections/rows. Multiple rows often reference the same file - no
    # need to check it multiple times.
    refs_by_folder = {}  # folder -> set of (col_name, filename_with_ext)
    for sel in selections:
        for row in sel.get("rows", []):
            for col_name, filename in (row.get("documentationData") or {}).items():
                dc = col_meta.get(col_name)
                if not dc:
                    continue
                full = f"{filename}.{dc['fileExtension']}"
                refs_by_folder.setdefault(dc["folder"], set()).add((col_name, full))

    # Walk each referenced folder once, list its files, and classify each
    # reference as present / missing. For missing ones, look for the
    # closest match in the folder and suggest it.
    total_refs = sum(len(s) for s in refs_by_folder.values())
    missing_entries = []

    for folder, refs in refs_by_folder.items():
        folder_path = os.path.join(product_root, folder)
        if not os.path.isdir(folder_path):
            for col_name, fname in sorted(refs):
                missing_entries.append({
                    "col_name": col_name,
                    "filename": fname,
                    "folder": folder,
                    "folder_exists": False,
                    "suggestion": None,
                })
            continue

        actual_files = sorted(os.listdir(folder_path))
        actual_set_lower = {f.lower(): f for f in actual_files}

        for col_name, fname in sorted(refs):
            # Case-sensitive match - the happy path
            if fname in actual_set_lower.values():
                continue
            # Case-insensitive - Windows filesystems are typically
            # case-insensitive, so this would still "work" in browsers but
            # it's worth noting.
            if fname.lower() in actual_set_lower:
                continue
            # Truly missing. Suggest the nearest filename.
            matches = get_close_matches(fname, actual_files, n=1, cutoff=0.5)
            missing_entries.append({
                "col_name": col_name,
                "filename": fname,
                "folder": folder,
                "folder_exists": True,
                "suggestion": matches[0] if matches else None,
            })

    n_missing = len(missing_entries)
    print(f"  File check: {total_refs} unique file(s) referenced, {n_missing} missing")
    if n_missing == 0:
        return

    # Cap output to avoid flooding the terminal on big mismatches
    display_limit = 25
    shown = missing_entries[:display_limit]
    for m in shown:
        line = (f"    MISSING [{m['col_name']}]: '{m['filename']}' "
                f"in '{m['folder']}'")
        if not m["folder_exists"]:
            line += "   (folder does not exist)"
        print(line)
        if m["suggestion"]:
            print(f"      -> closest real file: '{m['suggestion']}'")
    if n_missing > display_limit:
        print(f"    ... plus {n_missing - display_limit} more missing file(s)")


def extract_doc_columns(ws, doc_cols, actual_folders):
    """Read the documentation column names from row 2 of the DOCUMENTATION section.

    For each column, decide which actual folder on disk it maps to. If a
    matching folder is found under HHpro/ASSETS/<product>/, use that name
    (preserving the user's casing). Otherwise fall back to DOC_FOLDER_MAP
    for a best-guess name.
    """
    min_col, max_col = doc_cols
    docs = []
    for c in range(min_col, max_col + 1):
        name = clean_value(ws.cell(row=2, column=c).value)
        if not name:
            continue

        map_info = resolve_doc_folder(name)
        matched = match_folder_name(name, actual_folders) if actual_folders else None

        if matched:
            folder = matched
            # Extension is still taken from the map (REVIT/CAD are .zip,
            # everything else is .pdf). The map's extension guess is
            # reliable enough for this.
            file_ext = map_info["fileExtension"]
            source = "filesystem"
        else:
            folder = map_info["folder"]
            file_ext = map_info["fileExtension"]
            source = "fallback"
            if actual_folders:
                # We scanned but couldn't match - warn so the user can
                # either rename their folder or add it.
                print(f"  WARNING: Doc column '{name}' did not match any "
                      f"folder under ASSETS. Using '{folder}' as a guess; "
                      f"folders found: {sorted(actual_folders)}")
            elif map_info.get("_unrecognized"):
                print(f"  WARNING: Documentation column '{name}' does not "
                      f"match any known folder prefix. Check DOC_FOLDER_MAP "
                      f"in the script.")

        docs.append({
            "name": name,
            "col": get_column_letter(c),
            "folder": folder,
            "fileExtension": file_ext,
        })

    return docs


def find_last_data_row(ws, data_start_row, schedule_cols):
    """
    Scan downward from data_start_row and return the last row that has any
    value in the schedule range. Used to trim off the trailing empty rows
    that Excel pads some files with (e.g. MARVAIR goes to row 1048570).
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
            # Stop after 20 consecutive empty rows - safe margin for any gaps
            # inside the data while still stopping quickly on trailing empties.
            if empty_streak >= 20:
                break
        row += 1
    return last


def build_groups(ws, data_start_row, data_end_row, schedule_cols,
                 supports_multi_row, cell_to_merge):
    """
    Return a list of (group_start_row, group_end_row) tuples. For products
    without multi-row selections, each data row is its own group. For
    multi-row products, rows linked by a multi-row merge in the schedule
    range are joined into one group.
    """
    if not supports_multi_row:
        return [(r, r) for r in range(data_start_row, data_end_row + 1)]

    min_col, max_col = schedule_cols
    # Build row -> set of (groupStart, groupEnd) bounds contributed by every
    # multi-row merge that overlaps this row in the schedule range.
    row_groups = {r: [r, r] for r in range(data_start_row, data_end_row + 1)}

    for mr in ws.merged_cells.ranges:
        if mr.min_col < min_col or mr.max_col > max_col:
            continue
        if mr.min_row < data_start_row or mr.max_row > data_end_row:
            continue
        if mr.max_row == mr.min_row:
            continue  # single-row merge isn't a grouping signal
        # Every row in this merge belongs to the same group
        for r in range(mr.min_row, mr.max_row + 1):
            bounds = row_groups[r]
            bounds[0] = min(bounds[0], mr.min_row)
            bounds[1] = max(bounds[1], mr.max_row)

    # Now walk from data_start_row to data_end_row, coalescing any rows whose
    # bounds overlap (handles overlapping merges cleanly).
    groups = []
    r = data_start_row
    while r <= data_end_row:
        lo, hi = row_groups[r]
        # Expand hi if any row within [lo, hi] reaches further
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
    """
    Read one row of data between col_start and col_end. Returns a dict keyed
    by column letter, with only cells that have a value. If a cell is inside
    a multi-row merge and is NOT the anchor, it is skipped (value belongs to
    the anchor row of the group, not this row).
    """
    data = {}
    for c in range(col_start, col_end + 1):
        val = clean_value(ws.cell(row=row, column=c).value)
        if val is None:
            continue
        data[get_column_letter(c)] = val
    return data


def row_horizontal_spans(cell_to_merge, row, col_start, col_end):
    """
    Detect horizontal merges on a single data row within the schedule range.

    Returns a dict mapping the TOP-LEFT column letter of each horizontal merge
    to the number of columns it spans (colspan). Only merges with colspan > 1
    and whose full extent is within [col_start, col_end] are included.

    Example: on a Mini Splits row where J:L is merged (Voltage/MCA/MOP) with
    "Indoor Powered From Outdoor Unit", this returns {"J": 3}.

    Vertical-only merges (rowspan > 1, colspan == 1) are ignored here - those
    are already handled separately by the row-group logic that builds
    multi-row selections.
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
        # Only emit if the merge is fully within the schedule range AND the
        # merge's anchor is on this row (otherwise we'd double-emit on later
        # rows of a multi-row merge).
        if mr.min_col < col_start or mr.max_col > col_end:
            continue
        if mr.min_row != row:
            continue
        spans[get_column_letter(mr.min_col)] = colspan
    return spans


def extract_selections(ws, groups, schedule_cols, filter_cols, doc_cols,
                       filter_columns_meta, doc_columns_meta, cell_to_merge):
    """Build the selections list from the grouped row ranges."""
    selections = []
    for i, (lo, hi) in enumerate(groups, start=1):
        sel_id = f"sel_{i:04d}"
        rows_out = []
        for r in range(lo, hi + 1):
            row_entry = {
                "scheduleData": row_data_for_range(ws, r, schedule_cols[0], schedule_cols[1]),
                "filterData": row_data_for_range_by_name(ws, r, filter_columns_meta),
                "documentationData": row_data_for_range_by_name(ws, r, doc_columns_meta),
            }
            spans = row_horizontal_spans(cell_to_merge, r, schedule_cols[0], schedule_cols[1])
            if spans:
                row_entry["scheduleCellSpans"] = spans
            rows_out.append(row_entry)
        selections.append({"id": sel_id, "rows": rows_out})
    return selections


def row_data_for_range_by_name(ws, row, columns_meta):
    """
    Same as row_data_for_range, but keyed by the column's display name
    instead of its letter. Used for filterData and documentationData.
    """
    out = {}
    for meta in columns_meta:
        c = column_index_from_string(meta["col"])
        val = clean_value(ws.cell(row=row, column=c).value)
        if val is None:
            continue
        out[meta["name"]] = val
    return out


def extract_schedule_notes(wb):
    """Read the SCHEDULE NOTES tab and return a structured notes object.

    Auto-detects the Marvair three-section layout by checking cell A1
    of the SCHEDULE NOTES tab. Any sheet whose A1 starts with
    'STANDARD OPTIONS' gets parsed as Marvair; everything else gets
    parsed as a flat one-note-per-row list.

    Output shape (always an object, never a plain array):
      {"format": "list",     "notes":         [...]}
      {"format": "marvair",  "standard": [...], "configuration": [...],
                             "optional": [{"text": ..., "sub": [...]}, ...]}
    """
    if "SCHEDULE NOTES" not in wb.sheetnames:
        return {"format": "list", "notes": []}
    ws = wb["SCHEDULE NOTES"]

    a1 = ws.cell(row=1, column=1).value
    a1_str = str(a1).strip().upper() if a1 is not None else ""
    if a1_str.startswith("STANDARD OPTIONS"):
        return _parse_marvair_notes(ws)
    return _parse_simple_notes(ws)


def _parse_simple_notes(ws):
    """Read notes from column A of the SCHEDULE NOTES tab, one per row.

    Used for Gas Packs / Mini Splits / Multi Position Splits and any
    future product type that uses a plain flat list of notes. Blank
    rows are skipped.
    """
    notes = []
    for r in range(1, ws.max_row + 1):
        val = clean_value(ws.cell(row=r, column=1).value)
        if val:
            notes.append(str(val))
    return {"format": "list", "notes": notes}


def _parse_marvair_notes(ws):
    """Parse the three-section Marvair SCHEDULE NOTES layout.

    Expected structure:
      Row 1:       A = 'STANDARD OPTIONS/ACCESSORIES:'
      Rows 2..N:   Left notes  - A = '1-' / B = text
                   Right notes - on the same rows, some further
                                 column has 'N-' followed by text
      Row N+1:     A = 'OPTIONAL ACCESSORIES:'
      Some row:    another column has 'CONFIGURATION:'
      Below OPTIONAL:
        - Main notes:  A = 'N-' / B = text
        - Sub-notes:   B = '-' / C = text (tied to the most recent
                       main note above)
      Below CONFIGURATION: numbered notes in config_col / config_col+1.

    Returns:
      {
        "format": "marvair",
        "standard":      [ "note text", ... ],
        "configuration": [ "note text", ... ],
        "optional":      [ {"text": "...", "sub": [ "...", ... ]}, ... ]
      }
    """
    standard = []
    configuration = []
    optional = []

    # --- Locate the three section markers ------------------------------
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
        # CONFIGURATION label may appear in any column
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

    # --- STANDARD section ----------------------------------------------
    # Starts on the row after the 'STANDARD OPTIONS' label and ends just
    # before 'OPTIONAL ACCESSORIES' (or end of sheet if that's missing).
    # The Marvair layout has notes 1-7 in the LEFT column (A/B) and
    # notes 8-14 in the RIGHT column (usually G/H but we detect it).
    # We collect the left column first, then the right column, so the
    # output list is ordered 1..14 rather than interleaved.
    std_start = (standard_row + 1) if standard_row else 1
    std_end = (optional_row - 1) if optional_row else ws.max_row

    # Pass 1: left column - text in B
    for r in range(std_start, std_end + 1):
        b = ws.cell(row=r, column=2).value
        if b is not None and str(b).strip():
            standard.append(str(b).strip())

    # Pass 2: right column - scan each row for another 'N-' cell and
    # take the text from the cell immediately to its right. This handles
    # the two-column Marvair layout where notes 8-14 sit in a second
    # number/text pair (typically G/H but we auto-detect).
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

    # --- CONFIGURATION section -----------------------------------------
    if config_row is not None and config_col is not None:
        for r in range(config_row + 1, ws.max_row + 1):
            num = ws.cell(row=r, column=config_col).value
            if num is None:
                continue
            if not re.match(r"^\d+-$", str(num).strip()):
                break   # reached a non-numbered row - end of section
            text = ws.cell(row=r, column=config_col + 1).value
            if text is not None and str(text).strip():
                configuration.append(str(text).strip())

    # --- OPTIONAL section ----------------------------------------------
    # Each main note is anchored by a numbered row (A='N-', B=text).
    # Sub-notes are rows where B='-' and C=text, belonging to the most
    # recently-seen main note above them.
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
            # Any other pattern is ignored (blank rows, stray cells)

    return {
        "format": "marvair",
        "standard": standard,
        "configuration": configuration,
        "optional": optional,
    }


def convert_file(input_path, config, output_path, hhpro_root):
    """Convert a single Excel file to JSON using the given config."""
    print(f"\nConverting: {os.path.basename(input_path)}")
    wb = openpyxl.load_workbook(input_path, data_only=True)

    if "SCHEDULE" not in wb.sheetnames:
        raise RuntimeError(f"'SCHEDULE' tab not found in {input_path}")
    ws = wb["SCHEDULE"]

    sections = find_row1_sections(ws)
    schedule_cols = sections["SCHEDULE RANGE"]
    filter_cols = sections["FILTERS"]
    doc_cols = sections["DOCUMENTATION"]

    cell_to_merge, anchors = merge_lookup(ws)

    # Schedule title - the row-2 merged cell that spans the schedule range
    schedule_title = clean_value(ws.cell(row=2, column=schedule_cols[0]).value)

    # Headers, filters
    schedule_header_rows = extract_schedule_header(
        ws, schedule_cols, config["headerRows"], cell_to_merge, anchors
    )
    filter_columns = extract_filter_columns(ws, filter_cols)

    # Docs: scan this product's ASSETS subdirectory so we use the user's
    # actual folder names (e.g. 'ENGINEERING MANUAL' vs 'ENGINEERING MANUALS')
    actual_folders = scan_product_assets(hhpro_root, config.get("assetsFolder"))
    if actual_folders:
        print(f"  ASSETS/{config['assetsFolder']}/ folders found: "
              f"{sorted(actual_folders)}")
    elif config.get("assetsFolder"):
        print(f"  NOTE: Could not read ASSETS/{config['assetsFolder']}/ - "
              f"using DOC_FOLDER_MAP fallbacks for folder names. Re-run this "
              f"script from inside the HHpro project so it can see ASSETS.")
    doc_columns = extract_doc_columns(ws, doc_cols, actual_folders)

    # Data
    data_end_row = find_last_data_row(ws, config["dataStartRow"], schedule_cols)
    groups = build_groups(
        ws,
        config["dataStartRow"],
        data_end_row,
        schedule_cols,
        config["supportsMultiRow"],
        cell_to_merge,
    )
    selections = extract_selections(
        ws, groups, schedule_cols, filter_cols, doc_cols,
        filter_columns, doc_columns, cell_to_merge,
    )

    # Schedule notes
    schedule_notes = extract_schedule_notes(wb)

    # Build the full column-letter list for the schedule range
    schedule_col_letters = [
        get_column_letter(c) for c in range(schedule_cols[0], schedule_cols[1] + 1)
    ]

    payload = {
        "productType": config["productType"],
        "scheduleTitle": schedule_title,
        "supportsMultiRowSelections": config["supportsMultiRow"],
        "scheduleHeader": {
            "columnLetters": schedule_col_letters,
            "rows": schedule_header_rows,
        },
        "filterColumns": filter_columns,
        "documentationColumns": doc_columns,
        "selections": selections,
        "scheduleNotes": schedule_notes,
        "_meta": {
            "sourceFile": os.path.basename(input_path),
            "generatedAt": datetime.now().isoformat(timespec="seconds"),
            "dataRowCount": data_end_row - config["dataStartRow"] + 1,
            "selectionCount": len(selections),
        },
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"  -> {len(selections)} selections written to {os.path.basename(output_path)}")
    if config["supportsMultiRow"]:
        multi = sum(1 for s in selections if len(s["rows"]) > 1)
        print(f"     ({multi} multi-row selections, "
              f"{len(selections) - multi} single-row selections)")

    # Diagnostic pass: check every Excel filename references an actual file
    # on disk. Prints a list of mismatches and suggested real filenames so
    # the user can fix their Excel or rename their PDFs.
    validate_selection_files(selections, doc_columns, hhpro_root, config.get("assetsFolder"))


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # JSON output folder is ..\JSON relative to this script
    output_dir = os.path.abspath(os.path.join(script_dir, "..", "JSON"))
    os.makedirs(output_dir, exist_ok=True)

    # Locate HHpro project root so we can read the ASSETS folder structure
    # and use the user's actual folder names in the generated JSON.
    hhpro_root = find_hhpro_root()

    print(f"Input folder : {script_dir}")
    print(f"Output folder: {output_dir}")
    if hhpro_root:
        print(f"HHpro root   : {hhpro_root}")
    else:
        print("HHpro root   : (not found - folder names will use fallbacks)")

    converted = 0
    skipped = []
    for fname in sorted(os.listdir(script_dir)):
        if not fname.lower().endswith(".xlsx"):
            continue
        if fname.startswith("~$"):  # Excel lock files
            continue
        if fname not in PRODUCT_CONFIGS:
            skipped.append(fname)
            continue
        config = PRODUCT_CONFIGS[fname]
        input_path = os.path.join(script_dir, fname)
        output_path = os.path.join(output_dir, config["outputFileName"])
        try:
            convert_file(input_path, config, output_path, hhpro_root)
            converted += 1
        except Exception as e:
            print(f"  ERROR processing {fname}: {e}")

    print(f"\nDone. Converted {converted} file(s).")
    if skipped:
        print("Skipped (no config entry in PRODUCT_CONFIGS):")
        for f in skipped:
            print(f"  - {f}")
        print("Add an entry to PRODUCT_CONFIGS to include these files.")


if __name__ == "__main__":
    # Wrap the whole run in try/finally so the window stays open regardless
    # of whether the script finished cleanly, hit an error, or was Ctrl+C'd.
    # Without this, double-clicking the .py on Windows makes the console
    # flash up and close before you can read any of the output.
    try:
        main()
    except Exception as e:
        # Still print the error so it's visible in the paused window instead
        # of disappearing with the console.
        import traceback
        print("\nScript stopped due to an unexpected error:")
        traceback.print_exc()
    finally:
        try:
            input("\nPress Enter to close this window...")
        except EOFError:
            # If the script is piped or running non-interactively (no stdin),
            # just exit normally.
            pass