"""
Convert_MiniSplit_To_JSON.py

Reads MINI SPLIT DATA.xlsx and produces a structured mini-splits.json file.
Place this script in the HHpro/DATA/ folder and run from there:
    cd HHpro/DATA
    python Convert_MiniSplit_To_JSON.py

Output: HHpro/DATA/JSON/mini-splits.json
"""

import json
import os
import pandas as pd


# ---------------------------------------------------------------------------
# Paths  (relative to this script living in HHpro/DATA/)
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXCEL_PATH = os.path.join(SCRIPT_DIR, "MINI SPLIT DATA.xlsx")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "JSON")
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "mini-splits.json")

# Asset base path relative to HHpro root (used in the JSON for file linking)
ASSET_BASE = "ASSETS/MINI SPLITS"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def clean(val):
    """Return None for NaN, empty, or dash-only cells. Otherwise return the
    value with whitespace stripped (if string)."""
    if pd.isna(val):
        return None
    if isinstance(val, str):
        stripped = val.strip()
        if stripped == "" or stripped == "-":
            return None
        return stripped
    return val


def to_num(val):
    """Attempt to convert a value to int or float. Return None on failure."""
    val = clean(val)
    if val is None:
        return None
    try:
        f = float(val)
        return int(f) if f == int(f) else f
    except (ValueError, TypeError):
        return val


def doc_path(folder, filename, extension):
    """Build a relative asset path from HHpro root, or return None."""
    if filename is None:
        return None
    return f"{ASSET_BASE}/{folder}/{filename}{extension}"


# ---------------------------------------------------------------------------
# Column index constants  (0-based, matching header=None read)
# ---------------------------------------------------------------------------

# Schedule columns A-Z  (the visible mechanical schedule)
COL_A  = 0   # Indoor Symbol
COL_B  = 1   # CFM
COL_C  = 2   # Cooling Capacity - EDB
COL_D  = 3   # Cooling Capacity - EWB
COL_E  = 4   # Cooling Capacity - Total
COL_F  = 5   # Cooling Capacity - Sensible
COL_G  = 6   # Heat Pump Heating Capacity - EDB
COL_H  = 7   # Heat Pump Heating Capacity - Total
COL_I  = 8   # Operating Weight (Indoor)
COL_J  = 9   # Indoor Unit Type
COL_K  = 10  # Indoor Electrical - Voltage
COL_L  = 11  # Indoor Electrical - MCA
COL_M  = 12  # Indoor Electrical - MOP
COL_N  = 13  # Manufacturer Indoor (DAIKIN model)
COL_O  = 14  # Outdoor Symbol
COL_P  = 15  # OA Ambient (Cooling)
COL_Q  = 16  # OA Ambient (Heating)
COL_R  = 17  # Operating Weight (Outdoor)
COL_S  = 18  # SEER2 / EER2 / HSPF2
COL_T  = 19  # Outdoor Electrical - Voltage
COL_U  = 20  # Outdoor Electrical - MCA
COL_V  = 21  # Outdoor Electrical - MOP
COL_W  = 22  # Manufacturer Outdoor (DAIKIN model)
COL_X  = 23  # Refrigerant
COL_Y  = 24  # Max Allowable Line-Set Lengths
COL_Z  = 25  # Accessories

# Filter columns AB-AM
COL_AB = 27  # Outdoor System Size (tons)
COL_AC = 28  # HEAT PUMP or COOLING ONLY
COL_AD = 29  # Indoor Unit #1 Size (tons)
COL_AE = 30  # Indoor Unit #2 Size (tons)
COL_AF = 31  # Indoor Unit #3 Size (tons)
COL_AG = 32  # Indoor Unit #4 Size (tons)
COL_AH = 33  # Indoor Unit #5 Size (tons)
COL_AI = 34  # Indoor Unit #1 Type
COL_AJ = 35  # Indoor Unit #2 Type
COL_AK = 36  # Indoor Unit #3 Type
COL_AL = 37  # Indoor Unit #4 Type
COL_AM = 38  # Indoor Unit #5 Type

# Documentation columns AO-AZ
COL_AO = 40  # Submittal (System) - single-zone only
COL_AP = 41  # Submittal (Multi Split Outdoor Unit)
COL_AQ = 42  # Submittal (Multi Split Indoor Units)
COL_AR = 43  # Engineering Manual
COL_AS = 44  # Capacity Table
COL_AT = 45  # Installation Manual (Outdoor)
COL_AU = 46  # Installation Manual (Indoor)
COL_AV = 47  # Operation Manual
COL_AW = 48  # Revit (Outdoor)
COL_AX = 49  # Revit (Indoor)
COL_AY = 50  # CAD (Outdoor)
COL_AZ = 51  # CAD (Indoor)

# Grouped references for iteration
INDOOR_SIZE_COLS = [COL_AD, COL_AE, COL_AF, COL_AG, COL_AH]
INDOOR_TYPE_COLS = [COL_AI, COL_AJ, COL_AK, COL_AL, COL_AM]

# Data boundaries
FIRST_DATA_ROW = 5       # 0-based index  (Excel row 6)
DATA_END_MARKER = "ACCESSORIES:"

# Electrical type constants
ELEC_INDOOR_POWERED = "Indoor Powered from Outdoor"
ELEC_DUAL_POINT     = "Dual Point Power"


# ---------------------------------------------------------------------------
# Read Excel
# ---------------------------------------------------------------------------
print(f"Reading: {EXCEL_PATH}")
df = pd.read_excel(EXCEL_PATH, header=None)

# Find end of system data (row containing "ACCESSORIES:" in column A)
last_data_row = len(df)
for idx in range(FIRST_DATA_ROW, len(df)):
    val = df.iloc[idx, COL_A]
    if pd.notna(val) and DATA_END_MARKER in str(val):
        last_data_row = idx
        break

print(f"Data rows: {FIRST_DATA_ROW} through {last_data_row - 1}  "
      f"({last_data_row - FIRST_DATA_ROW} rows)")


# ---------------------------------------------------------------------------
# Identify system groups
#   Each system starts at an "ODU anchor row" (column O is populated).
#   Subsequent rows without column O data are additional indoor units
#   belonging to the same system.
# ---------------------------------------------------------------------------
odu_indices = []
for idx in range(FIRST_DATA_ROW, last_data_row):
    if pd.notna(df.iloc[idx, COL_O]) and str(df.iloc[idx, COL_O]).strip() != "":
        odu_indices.append(idx)

systems_raw = []
for i, odu_idx in enumerate(odu_indices):
    next_odu = odu_indices[i + 1] if i + 1 < len(odu_indices) else last_data_row
    row_indices = list(range(odu_idx, next_odu))
    systems_raw.append(row_indices)

print(f"Systems found: {len(systems_raw)}")


# ---------------------------------------------------------------------------
# Build indoor unit object from a single row
# ---------------------------------------------------------------------------
def build_indoor_unit(row_idx):
    electrical_raw = clean(df.iloc[row_idx, COL_K])
    powered_from_outdoor = (
        electrical_raw is not None
        and "Indoor Powered" in str(electrical_raw)
    )

    return {
        "symbol":               clean(df.iloc[row_idx, COL_A]),
        "cfm":                  to_num(df.iloc[row_idx, COL_B]),
        "coolingEdb":           to_num(df.iloc[row_idx, COL_C]),
        "coolingEwb":           to_num(df.iloc[row_idx, COL_D]),
        "coolingTotal":         to_num(df.iloc[row_idx, COL_E]),
        "coolingSensible":      to_num(df.iloc[row_idx, COL_F]),
        "heatingEdb":           to_num(df.iloc[row_idx, COL_G]),
        "heatingTotal":         to_num(df.iloc[row_idx, COL_H]),
        "weight":               to_num(df.iloc[row_idx, COL_I]),
        "type":                 clean(df.iloc[row_idx, COL_J]),
        "poweredFromOutdoor":   powered_from_outdoor,
        "voltage":              None if powered_from_outdoor else clean(df.iloc[row_idx, COL_K]),
        "mca":                  None if powered_from_outdoor else to_num(df.iloc[row_idx, COL_L]),
        "mop":                  None if powered_from_outdoor else to_num(df.iloc[row_idx, COL_M]),
        "manufacturer":         clean(df.iloc[row_idx, COL_N]),
    }


# ---------------------------------------------------------------------------
# Build per-indoor-unit documentation from a single row
# ---------------------------------------------------------------------------
def build_indoor_docs(row_idx):
    submittal_indoor = clean(df.iloc[row_idx, COL_AQ])
    install_indoor   = clean(df.iloc[row_idx, COL_AU])
    operation        = clean(df.iloc[row_idx, COL_AV])
    revit_indoor     = clean(df.iloc[row_idx, COL_AX])
    cad_indoor       = clean(df.iloc[row_idx, COL_AZ])

    return {
        "submittalIndoor":      doc_path("SUBMITTALS", submittal_indoor, ".pdf"),
        "installManualIndoor":  doc_path("INSTALLATION MANUALS", install_indoor, ".pdf"),
        "operationManual":      doc_path("OPERATION MANUALS", operation, ".pdf"),
        "revitIndoor":          doc_path("REVIT", revit_indoor, ".zip"),
        "cadIndoor":            doc_path("CAD", cad_indoor, ".zip"),
    }


# ---------------------------------------------------------------------------
# Determine electrical type for a system
# ---------------------------------------------------------------------------
def determine_electrical_type(row_indices):
    """Check the first indoor unit's electrical column to determine the
    electrical configuration for the entire system."""
    first_row = row_indices[0]
    electrical_raw = clean(df.iloc[first_row, COL_K])
    if electrical_raw is not None and "Indoor Powered" in str(electrical_raw):
        return ELEC_INDOOR_POWERED
    return ELEC_DUAL_POINT


# ---------------------------------------------------------------------------
# Build a complete system object
# ---------------------------------------------------------------------------
def build_system(system_id, row_indices):
    odu_idx    = row_indices[0]   # anchor row with outdoor unit data
    num_indoor = len(row_indices)

    # ----- Outdoor Unit (from anchor row only) -----
    outdoor_unit = {
        "symbol":           clean(df.iloc[odu_idx, COL_O]),
        "manufacturer":     clean(df.iloc[odu_idx, COL_W]),
        "coolingAmbient":   to_num(df.iloc[odu_idx, COL_P]),
        "heatingAmbient":   to_num(df.iloc[odu_idx, COL_Q]),
        "weight":           to_num(df.iloc[odu_idx, COL_R]),
        "seer":             clean(df.iloc[odu_idx, COL_S]),
        "voltage":          clean(df.iloc[odu_idx, COL_T]),
        "mca":              to_num(df.iloc[odu_idx, COL_U]),
        "mop":              to_num(df.iloc[odu_idx, COL_V]),
        "refrigerant":      clean(df.iloc[odu_idx, COL_X]),
        "lineSet":          clean(df.iloc[odu_idx, COL_Y]),
    }

    # ----- Indoor Units (one per row in the group) -----
    indoor_units = [build_indoor_unit(idx) for idx in row_indices]

    # ----- Electrical Type -----
    electrical_type = determine_electrical_type(row_indices)

    # ----- Filters (from anchor row) -----
    indoor_sizes = []
    indoor_types = []
    for i in range(5):
        indoor_sizes.append(to_num(df.iloc[odu_idx, INDOOR_SIZE_COLS[i]]))
        indoor_types.append(clean(df.iloc[odu_idx, INDOOR_TYPE_COLS[i]]))

    filters = {
        "systemType":       clean(df.iloc[odu_idx, COL_AC]),
        "outdoorSize":      to_num(df.iloc[odu_idx, COL_AB]),
        "numIndoor":        num_indoor,
        "indoorSizes":      indoor_sizes[:num_indoor],
        "indoorTypes":      indoor_types[:num_indoor],
        "electricalType":   electrical_type,
    }

    # ----- Documentation -----
    # System-level docs (from anchor row)
    submittal_sys  = clean(df.iloc[odu_idx, COL_AO])
    submittal_odu  = clean(df.iloc[odu_idx, COL_AP])
    eng_manual     = clean(df.iloc[odu_idx, COL_AR])
    cap_table      = clean(df.iloc[odu_idx, COL_AS])
    install_odu    = clean(df.iloc[odu_idx, COL_AT])
    revit_odu      = clean(df.iloc[odu_idx, COL_AW])
    cad_odu        = clean(df.iloc[odu_idx, COL_AY])

    # Per-indoor-unit docs (from each row)
    indoor_docs = [build_indoor_docs(idx) for idx in row_indices]

    docs = {
        "submittalSystem":      doc_path("SUBMITTALS", submittal_sys, ".pdf"),
        "submittalOutdoor":     doc_path("SUBMITTALS", submittal_odu, ".pdf"),
        "engineeringManual":    doc_path("ENGINEERING MANUAL", eng_manual, ".pdf"),
        "capacityTable":        doc_path("CAPACITY TABLES", cap_table, ".pdf"),
        "installManualOutdoor": doc_path("INSTALLATION MANUALS", install_odu, ".pdf"),
        "revitOutdoor":         doc_path("REVIT", revit_odu, ".zip"),
        "cadOutdoor":           doc_path("CAD", cad_odu, ".zip"),
        "indoorDocs":           indoor_docs,
    }

    # ----- Accessories (from anchor row) -----
    accessories = clean(df.iloc[odu_idx, COL_Z])

    return {
        "id":           f"ms_{system_id:04d}",
        "outdoorUnit":  outdoor_unit,
        "indoorUnits":  indoor_units,
        "filters":      filters,
        "docs":         docs,
        "accessories":  accessories,
    }


# ---------------------------------------------------------------------------
# Build all systems
# ---------------------------------------------------------------------------
systems = []
for i, row_indices in enumerate(systems_raw):
    systems.append(build_system(i + 1, row_indices))


# ---------------------------------------------------------------------------
# Summary statistics (for validation)
# ---------------------------------------------------------------------------
zone_counts = {}
for s in systems:
    n = s["filters"]["numIndoor"]
    zone_counts[n] = zone_counts.get(n, 0) + 1

type_counts = {}
for s in systems:
    t = s["filters"]["systemType"] or "UNKNOWN"
    type_counts[t] = type_counts.get(t, 0) + 1

elec_counts = {}
for s in systems:
    e = s["filters"]["electricalType"]
    elec_counts[e] = elec_counts.get(e, 0) + 1

print(f"\nSystems by zone count:")
for k in sorted(zone_counts):
    print(f"  {k}-zone: {zone_counts[k]}")

print(f"\nSystems by type:")
for k, v in sorted(type_counts.items()):
    print(f"  {k}: {v}")

print(f"\nSystems by electrical type:")
for k, v in sorted(elec_counts.items()):
    print(f"  {k}: {v}")


# ---------------------------------------------------------------------------
# Collect unique filter values (used by the site to populate dropdowns)
# ---------------------------------------------------------------------------
all_outdoor_sizes = sorted(set(
    s["filters"]["outdoorSize"] for s in systems
    if s["filters"]["outdoorSize"] is not None
))

all_indoor_sizes = sorted(set(
    size for s in systems
    for size in s["filters"]["indoorSizes"]
    if size is not None
))

all_indoor_types = sorted(set(
    t for s in systems
    for t in s["filters"]["indoorTypes"]
    if t is not None
))

all_system_types = sorted(set(
    s["filters"]["systemType"] for s in systems
    if s["filters"]["systemType"] is not None
))

all_electrical_types = sorted(set(
    s["filters"]["electricalType"] for s in systems
))

filter_options = {
    "systemTypes":      all_system_types,
    "outdoorSizes":     all_outdoor_sizes,
    "indoorSizes":      all_indoor_sizes,
    "indoorTypes":      all_indoor_types,
    "electricalTypes":  all_electrical_types,
    "maxIndoorUnits":   max(zone_counts.keys()),
}

print(f"\nFilter options:")
print(f"  System types:      {all_system_types}")
print(f"  Outdoor sizes:     {all_outdoor_sizes}")
print(f"  Indoor sizes:      {all_indoor_sizes}")
print(f"  Indoor types:      {all_indoor_types}")
print(f"  Electrical types:  {all_electrical_types}")
print(f"  Max indoor units:  {filter_options['maxIndoorUnits']}")


# ---------------------------------------------------------------------------
# Write JSON
# ---------------------------------------------------------------------------
output = {
    "productType":      "Mini Splits",
    "manufacturer":     "DAIKIN",
    "generated":        pd.Timestamp.now().isoformat(),
    "totalSystems":     len(systems),
    "filterOptions":    filter_options,
    "systems":          systems,
}

os.makedirs(OUTPUT_DIR, exist_ok=True)

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

file_size = os.path.getsize(OUTPUT_PATH)
print(f"\nOutput written to: {OUTPUT_PATH}")
print(f"File size: {file_size / 1024:.1f} KB")
print("Done.")
