r"""
HHpro - File Validator
=======================

Checks whether the filenames referenced in the generated JSON files
actually exist in the HHpro/ASSETS/ folders.

Location (in the site's folder structure):
    HHpro\DATA\DATA FILES\validate_files.py

What it does:
    1. Walks up from this script's folder to find the HHpro project root
       (first ancestor that contains both ASSETS and DATA folders).
    2. Reads every .json file in HHpro\DATA\JSON\.
    3. For each JSON, looks at every selection's documentationData:
       for every (column, filename) entry, checks that
           HHpro\ASSETS\<assetsFolder>\<docFolder>\<filename>.<ext>
       actually exists on disk.
    4. Reports any mismatches: missing files, folders that don't exist,
       and (optionally) orphan files on disk that aren't referenced by
       any JSON.
    5. Writes a human-readable report to
           HHpro\DATA\DATA FILES\validation_report.txt

Output example (both to console and to the report file):

    === MARVAIR ===
      Selections in JSON      : 40
      Documentation refs      : 520 unique
      Missing files           : 3
      Orphan files on disk    : 2

      MISSING FILES:
        [SUBMITTAL (SYSTEM)]  'MARVAIR MGH DATA SHEET.pdf'
          folder: ASSETS\MARVAIR\SUBMITTALS
          suggestion: 'MARVAIR MGH DATASHEET.pdf'
        ...

      ORPHAN FILES (not referenced by any selection):
        ASSETS\MARVAIR\CAD\MGH3090AE.zip
        ...

Usage:
    python validate_files.py                - Scan all products
    python validate_files.py marvair        - Scan a single product JSON
    python validate_files.py --no-orphans   - Skip the orphan-file report
"""

import json
import os
import sys
from difflib import get_close_matches


REPORT_FILENAME = "validation_report.txt"
SUGGESTION_CUTOFF = 0.5   # difflib similarity threshold for suggestions
DISPLAY_LIMIT = 50        # max missing entries shown per product in console


# -----------------------------------------------------------------------------
# FILESYSTEM HELPERS
# -----------------------------------------------------------------------------

def find_hhpro_root():
    """Walk up from the script location looking for the HHpro project root.
    Identified as the first ancestor that contains both ASSETS and DATA."""
    here = os.path.dirname(os.path.abspath(__file__))
    cur = here
    for _ in range(6):
        if (os.path.isdir(os.path.join(cur, "ASSETS"))
                and os.path.isdir(os.path.join(cur, "DATA"))):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return None


def list_files_in(folder_path):
    """Return the list of regular filenames in a folder (not directories).
    Returns [] if the folder doesn't exist."""
    if not os.path.isdir(folder_path):
        return []
    return sorted(
        name for name in os.listdir(folder_path)
        if os.path.isfile(os.path.join(folder_path, name))
    )


# -----------------------------------------------------------------------------
# JSON DATA HELPERS
# -----------------------------------------------------------------------------

def load_all_jsons(json_dir, name_filter=None):
    """Read every .json file in json_dir. If name_filter is provided,
    only keep entries whose filename (without .json) contains the given
    substring (case-insensitive).

    Returns a list of (filename, payload_dict) tuples.
    """
    out = []
    for name in sorted(os.listdir(json_dir)):
        if not name.lower().endswith(".json"):
            continue
        if name_filter and name_filter.lower() not in name.lower():
            continue
        path = os.path.join(json_dir, name)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"  ERROR: could not read '{name}': {e}")
            continue
        out.append((name, data))
    return out


def collect_references(payload):
    """From a product JSON payload, build a dict:
        folder_name -> list of (columnName, filename_without_ext)

    Walks every selection's documentationData, maps each column to its
    declared folder (from documentationColumns), and collects references.
    """
    by_folder = {}
    col_meta = {
        dc["name"]: dc for dc in (payload.get("documentationColumns") or [])
    }
    for sel in (payload.get("selections") or []):
        for row in (sel.get("rows") or []):
            for col_name, filename in (row.get("documentationData") or {}).items():
                meta = col_meta.get(col_name)
                if not meta or not filename:
                    continue
                by_folder.setdefault(meta["folder"], []).append({
                    "column":   col_name,
                    "filename": str(filename),
                    "fileExt":  meta.get("fileExtension", ""),
                })
    return by_folder


# -----------------------------------------------------------------------------
# PER-PRODUCT VALIDATION
# -----------------------------------------------------------------------------

def validate_product(json_name, payload, hhpro_root, report_orphans=True):
    """Check a single product JSON against its ASSETS folder.

    Prints findings to stdout and returns a dict:
      {
        "product":       str,
        "assetsFolder":  str or None,
        "selectionCount": int,
        "refCount":       int,
        "missing":        [...entries...],
        "orphans":        [...paths...],
      }
    """
    product_type = payload.get("productType", "(unknown)")
    assets_folder = payload.get("assetsFolder")

    result = {
        "product":       product_type,
        "assetsFolder":  assets_folder,
        "selectionCount": len(payload.get("selections") or []),
        "refCount":       0,
        "missing":        [],
        "orphans":        [],
    }

    if not assets_folder or not hhpro_root:
        print(f"\n=== {product_type} ({json_name}) ===")
        print("  SKIP: assetsFolder missing from JSON or HHpro root not found.")
        return result

    product_path = os.path.join(hhpro_root, "ASSETS", assets_folder)
    if not os.path.isdir(product_path):
        print(f"\n=== {product_type} ({json_name}) ===")
        print(f"  SKIP: {product_path} does not exist.")
        return result

    refs_by_folder = collect_references(payload)

    # Collect all referenced full filenames (with extension) per folder so
    # we can also find orphans (files on disk that no selection uses).
    referenced_per_folder = {}   # folder -> set(full_filename)
    total_refs = 0

    for folder, refs in refs_by_folder.items():
        # De-duplicate by full filename within this folder
        seen = set()
        unique_refs = []
        for r in refs:
            full = r["filename"] + "." + r["fileExt"] if r["fileExt"] else r["filename"]
            key = (r["column"], full)
            if key in seen:
                continue
            seen.add(key)
            unique_refs.append(dict(r, _full=full))
        total_refs += len(unique_refs)

        folder_path = os.path.join(product_path, folder)
        if not os.path.isdir(folder_path):
            # Entire folder missing
            for r in unique_refs:
                result["missing"].append({
                    "column":        r["column"],
                    "full_filename": r["_full"],
                    "folder":        folder,
                    "folder_exists": False,
                    "suggestion":    None,
                })
            referenced_per_folder[folder] = set(r["_full"] for r in unique_refs)
            continue

        actual = list_files_in(folder_path)
        actual_lower = {f.lower(): f for f in actual}

        for r in unique_refs:
            full = r["_full"]
            if full in actual or full.lower() in actual_lower:
                continue
            # Missing - suggest the closest filename as a hint
            matches = get_close_matches(full, actual, n=1, cutoff=SUGGESTION_CUTOFF)
            result["missing"].append({
                "column":        r["column"],
                "full_filename": full,
                "folder":        folder,
                "folder_exists": True,
                "suggestion":    matches[0] if matches else None,
            })

        referenced_per_folder[folder] = set(r["_full"] for r in unique_refs)

    # Orphan files: any actual file in any of the product's ASSETS
    # sub-folders that isn't referenced by a selection.
    if report_orphans:
        for folder_name in sorted(os.listdir(product_path)):
            folder_path = os.path.join(product_path, folder_name)
            if not os.path.isdir(folder_path):
                continue
            actual = list_files_in(folder_path)
            if not actual:
                continue
            referenced = referenced_per_folder.get(folder_name, set())
            referenced_lower = {r.lower() for r in referenced}
            for fname in actual:
                if fname in referenced or fname.lower() in referenced_lower:
                    continue
                rel = os.path.join("ASSETS", assets_folder, folder_name, fname)
                result["orphans"].append(rel)

    result["refCount"] = total_refs

    # ---- Print ------------------------------------------------------
    print(f"\n=== {product_type} ({json_name}) ===")
    print(f"  Selections in JSON      : {result['selectionCount']}")
    print(f"  Documentation refs      : {total_refs} unique")
    print(f"  Missing files           : {len(result['missing'])}")
    if report_orphans:
        print(f"  Orphan files on disk    : {len(result['orphans'])}")

    if result["missing"]:
        print()
        print("  MISSING FILES:")
        shown = result["missing"][:DISPLAY_LIMIT]
        for m in shown:
            where = os.path.join("ASSETS", assets_folder, m["folder"])
            if not m["folder_exists"]:
                where += "   (folder does not exist)"
            print(f"    [{m['column']}]  '{m['full_filename']}'")
            print(f"       folder:     {where}")
            if m["suggestion"]:
                print(f"       suggestion: '{m['suggestion']}'")
        if len(result["missing"]) > DISPLAY_LIMIT:
            print(f"    ... plus {len(result['missing']) - DISPLAY_LIMIT} more "
                  f"(full list in report file)")

    if report_orphans and result["orphans"]:
        print()
        print("  ORPHAN FILES (not referenced by any selection):")
        shown = result["orphans"][:DISPLAY_LIMIT]
        for p in shown:
            print(f"    {p}")
        if len(result["orphans"]) > DISPLAY_LIMIT:
            print(f"    ... plus {len(result['orphans']) - DISPLAY_LIMIT} more "
                  f"(full list in report file)")

    return result


# -----------------------------------------------------------------------------
# REPORT FILE
# -----------------------------------------------------------------------------

def write_report(report_path, results, hhpro_root, report_orphans):
    """Write a full-detail report file so users have a complete record
    even when a product's missing-file count exceeds the console cap."""
    from datetime import datetime

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("HHpro - Asset validation report\n")
        f.write(f"Generated: {datetime.now().isoformat(timespec='seconds')}\n")
        f.write(f"HHpro root: {hhpro_root}\n")
        f.write("=" * 70 + "\n\n")

        grand_missing = 0
        grand_orphans = 0

        for r in results:
            f.write(f"=== {r['product']} ===\n")
            f.write(f"  Assets folder     : {r['assetsFolder']}\n")
            f.write(f"  Selections        : {r['selectionCount']}\n")
            f.write(f"  References total  : {r['refCount']}\n")
            f.write(f"  Missing files     : {len(r['missing'])}\n")
            if report_orphans:
                f.write(f"  Orphan files      : {len(r['orphans'])}\n")
            f.write("\n")

            if r["missing"]:
                f.write("  MISSING FILES:\n")
                for m in r["missing"]:
                    where = os.path.join("ASSETS", r["assetsFolder"], m["folder"])
                    if not m["folder_exists"]:
                        where += "   (folder does not exist)"
                    f.write(f"    [{m['column']}]  '{m['full_filename']}'\n")
                    f.write(f"       folder:     {where}\n")
                    if m["suggestion"]:
                        f.write(f"       suggestion: '{m['suggestion']}'\n")
                f.write("\n")
                grand_missing += len(r["missing"])

            if report_orphans and r["orphans"]:
                f.write("  ORPHAN FILES (not referenced):\n")
                for p in r["orphans"]:
                    f.write(f"    {p}\n")
                f.write("\n")
                grand_orphans += len(r["orphans"])

            f.write("\n")

        f.write("=" * 70 + "\n")
        f.write(f"TOTAL missing files: {grand_missing}\n")
        if report_orphans:
            f.write(f"TOTAL orphan files : {grand_orphans}\n")


# -----------------------------------------------------------------------------
# MAIN
# -----------------------------------------------------------------------------

def parse_args(argv):
    opts = {"name_filter": None, "report_orphans": True}
    for a in argv[1:]:
        if a == "--no-orphans":
            opts["report_orphans"] = False
        elif a.startswith("--"):
            print(f"Unknown option: {a}")
            sys.exit(2)
        else:
            opts["name_filter"] = a
    return opts


def main():
    opts = parse_args(sys.argv)

    hhpro_root = find_hhpro_root()
    if not hhpro_root:
        print("ERROR: could not locate HHpro project root (looking for an "
              "ancestor folder that contains both ASSETS and DATA).")
        sys.exit(1)

    json_dir = os.path.join(hhpro_root, "DATA", "JSON")
    if not os.path.isdir(json_dir):
        print(f"ERROR: JSON directory does not exist: {json_dir}")
        print("Run convert_to_json.py first to generate the JSON files.")
        sys.exit(1)

    print(f"HHpro root : {hhpro_root}")
    print(f"JSON folder: {json_dir}")
    if opts["name_filter"]:
        print(f"Filter     : name contains '{opts['name_filter']}'")
    if not opts["report_orphans"]:
        print("Orphan check: disabled (--no-orphans)")

    jsons = load_all_jsons(json_dir, opts["name_filter"])
    if not jsons:
        print("\nNo JSON files matched. Nothing to do.")
        return

    results = []
    for name, payload in jsons:
        results.append(
            validate_product(name, payload, hhpro_root,
                             report_orphans=opts["report_orphans"])
        )

    # Summary
    total_missing = sum(len(r["missing"]) for r in results)
    total_orphans = sum(len(r["orphans"]) for r in results)
    print()
    print("=" * 60)
    print(f"SUMMARY: {total_missing} missing file(s) across {len(results)} "
          f"product(s).")
    if opts["report_orphans"]:
        print(f"         {total_orphans} orphan file(s) on disk.")

    # Full report
    report_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), REPORT_FILENAME
    )
    write_report(report_path, results, hhpro_root, opts["report_orphans"])
    print(f"\nFull report written to: {report_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        print("\nScript stopped due to an unexpected error:")
        traceback.print_exc()
    finally:
        try:
            input("\nPress Enter to close this window...")
        except EOFError:
            pass
