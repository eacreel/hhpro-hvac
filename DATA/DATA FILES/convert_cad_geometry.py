"""Normalize the per-model 2D DXF views in ASSETS/CAD_DXF into a compact
geometry store the CAD export embeds below the schedule.

For each model folder: flatten every front/right/top view to 2D polylines
(explodes nested INSERT blocks, drops dimension/text/hatch clutter), convert
to millimeters via $INSUNITS, record a bounding box. Output:

  DATA/JSON/cad_geometry.json
    { "<MODEL>": { "front": {"bbox":[x0,y0,x1,y1], "pl":[[[x,y],...],...]},
                   "right": {...}, "top": {...} }, ... }

Re-run whenever ASSETS/CAD_DXF changes. Pairs with convert_to_json.py.
"""
import ezdxf, glob, os, json
from ezdxf import disassemble

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CAD = os.path.join(ROOT, 'ASSETS', 'CAD_DXF')
OUT_DIR = os.path.join(ROOT, 'DATA', 'JSON', 'cad')   # one <MODEL>.json per model

SKIP = {'TEXT','MTEXT','ATTRIB','ATTDEF','DIMENSION','HATCH','LEADER',
        'MULTILEADER','MLEADER','WIPEOUT','IMAGE','POINT'}
INSUNIT_MM = {0:1.0, 1:25.4, 2:304.8, 4:1.0, 5:10.0, 6:1000.0}  # -> mm
VIEWS = ('front', 'right', 'top')

# Drop polylines whose bounding-box diagonal is smaller than this fraction of
# the whole view's diagonal. The manufacturer 2D views (esp. the DHG gas packs
# and MPS air handlers) explode into thousands of tiny louver/fin segments that
# are invisible at thumbnail scale but balloon the file. Relative, so it adapts
# to each drawing's size; ~1.5% keeps clean outlines ~intact while cutting the
# over-detailed ones by 70-85%.
SIMPLIFY_FRAC = 0.015


def _bbox(pls):
    xs = [x for pl in pls for x, _ in pl]
    ys = [y for pl in pls for _, y in pl]
    return [min(xs), min(ys), max(xs), max(ys)]


def view_file(model_dir, view):
    g = glob.glob(os.path.join(model_dir, '*' + view + '*.dxf'))
    return g[0] if g else None


def flatten(path):
    doc = ezdxf.readfile(path)
    msp = doc.modelspace()
    f = INSUNIT_MM.get(doc.header.get('$INSUNITS', 0), 1.0)
    # Chord tolerance for flattening curves, ~2mm real-world (in source units).
    # Drawings render small in the schedule, so finer detail is invisible and
    # just bloats the file.
    mfd = 2.0 / f
    ents = [e for e in disassemble.recursive_decompose(msp) if e.dxftype() not in SKIP]
    pls = []
    for p in disassemble.to_primitives(ents, max_flattening_distance=mfd):
        try:
            vs = [(int(round(v.x * f)), int(round(v.y * f))) for v in p.vertices()]
        except Exception:
            vs = []
        clean = [vs[0]] if vs else []
        for v in vs[1:]:
            if v != clean[-1]:
                clean.append(v)
        if len(clean) >= 2:
            pls.append(clean)
    if not pls:
        return None
    # Simplify: drop sub-threshold tiny polylines (fins/louvers/fasteners).
    b = _bbox(pls)
    diag = ((b[2] - b[0]) ** 2 + (b[3] - b[1]) ** 2) ** 0.5 or 1.0
    thr = SIMPLIFY_FRAC * diag
    kept = []
    for pl in pls:
        xs = [p[0] for p in pl]; ys = [p[1] for p in pl]
        if ((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2) ** 0.5 >= thr:
            kept.append(pl)
    if kept:
        pls = kept
    return {'bbox': _bbox(pls), 'pl': pls}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    models = sorted(d for d in os.listdir(CAD) if os.path.isdir(os.path.join(CAD, d)))
    written = []
    failures = []
    sizes = []
    for m in models:
        mdir = os.path.join(CAD, m)
        entry = {}
        for v in VIEWS:
            fp = view_file(mdir, v)
            if not fp:
                continue
            try:
                g = flatten(fp)
                if g:
                    entry[v] = g
            except Exception as e:
                failures.append((m, v, str(e)[:80]))
        if not entry:
            continue
        path = os.path.join(OUT_DIR, m + '.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(entry, f, separators=(',', ':'))
        written.append(m)
        sizes.append((os.path.getsize(path), m))
    # index of available models so the runtime can skip fetches for missing ones
    with open(os.path.join(OUT_DIR, '_index.json'), 'w', encoding='utf-8') as f:
        json.dump(sorted(written), f, separators=(',', ':'))
    total = sum(s for s, _ in sizes)
    sizes.sort(reverse=True)
    print(f'models written: {len(written)} / {len(models)}  | failures: {len(failures)}')
    for fl in failures[:20]:
        print('   ', fl)
    print(f'output dir: {OUT_DIR}  (total {round(total/1024/1024, 2)} MB)')
    print(f'largest: ' + ', '.join(f'{m}={round(s/1024)}KB' for s, m in sizes[:5]))
    print(f'median ~{round(sizes[len(sizes)//2][0]/1024)}KB')


if __name__ == '__main__':
    main()
