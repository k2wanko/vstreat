#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "numpy",
#   "opencv-python-headless",
#   "scikit-image",
#   "scipy",
#   "shapely",
# ]
# ///
"""
Trace land cover out of a nadir aerial photo into local-grid GeoJSON.

    uv run scripts/detect_landcover.py <worldId>

The photo carries no georeference, so the frame is *declared* to cover
terrain frameM metres square (from the town's world.json), north up, origin at
the image centre. That single number is what turns pixels into the metres the
rest of the pipeline speaks: +x east, +y north.

Reads  worlds/<id>/raw/aerial.png
Writes worlds/<id>/town.geojson   features in metres on the local grid
       worlds/<id>/raw/classes.png  the per-pixel classification, colour-coded
       worlds/<id>/raw/overlay.png  the vectors drawn back over the photo

The trace is a draft. Look at overlay.png, then edit town.geojson by hand -
that is part of the method, not a fallback.

Nothing here invents height. Elevation is a step-3 problem; this step only
records what the photograph actually shows.
"""

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage
from skimage.feature import peak_local_max
from skimage.morphology import skeletonize
from skimage.segmentation import watershed

if len(sys.argv) < 2:
    raise SystemExit("usage: detect_landcover.py <worldId>")
WORLD = sys.argv[1]
DIR = Path("worlds") / WORLD
SRC = DIR / "raw" / "aerial.png"
OUT = DIR / "raw"

# --- the one declared number, and it comes from the town ---------------------
FRAME_M = float(json.loads((DIR / "world.json").read_text())["frameM"])

bgr = cv2.imread(str(SRC), cv2.IMREAD_COLOR)
if bgr is None:
    raise SystemExit(f"cannot read {SRC}")
H, W = bgr.shape[:2]
if H != W:
    print(f"note: frame is {W}x{H}, not square; scale differs per axis")
MPP = FRAME_M / W  # metres per pixel

# Median blur first: roof ridges and wave texture are noise at the scale we
# are tracing, and they otherwise fragment every connected component.
sm = cv2.medianBlur(bgr, 7)
hsv = cv2.cvtColor(sm, cv2.COLOR_BGR2HSV)
hue, sat, val = hsv[..., 0].astype(np.int16), hsv[..., 1].astype(np.int16), hsv[..., 2].astype(np.int16)
lab = cv2.cvtColor(sm, cv2.COLOR_BGR2LAB)


def clean(mask, open_px=0, close_px=0):
    m = mask.astype(np.uint8)
    if open_px:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (open_px, open_px))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)
    if close_px:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_px, close_px))
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    return m.astype(bool)


def largest_components(mask, n=1, min_px=0):
    """Connected components of `mask`, biggest first."""
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    order = sorted(range(1, count), key=lambda i: -stats[i, cv2.CC_STAT_AREA])
    out = []
    for i in order[:n] if n else order:
        if stats[i, cv2.CC_STAT_AREA] < min_px:
            continue
        out.append(labels == i)
    return out


def fill_holes(mask):
    """Everything enclosed by `mask` becomes `mask` — seagrass inside the bay."""
    m = mask.astype(np.uint8).copy()
    pad = np.zeros((m.shape[0] + 2, m.shape[1] + 2), np.uint8)
    cv2.floodFill(m, pad, (0, 0), 1)
    return mask | (m == 0)


# Classes are assigned in priority order and each one is subtracted from what
# is left, so a pixel lands in exactly one class. Overlapping masks were the
# first version's undoing: the beach satisfied both "sand" and "bare earth",
# and whichever was drawn last won.
claimed = np.zeros((H, W), bool)


def take(mask):
    global claimed
    m = mask & ~claimed
    claimed = claimed | m
    return m


# --- water: blue-cyan and genuinely saturated --------------------------------
# Blue roofs pass this test too, which is why the sea is taken as the one
# component that reaches the frame edge, not as "everything blue".
water_like = clean((hue >= 80) & (hue <= 125) & (sat > 45) & (val > 35), open_px=3, close_px=9)

border = np.zeros((H, W), bool)
border[0, :] = border[-1, :] = True
border[:, 0] = border[:, -1] = True
sea = np.zeros((H, W), bool)
for comp in largest_components(water_like, n=0, min_px=2000):
    if (comp & border).any() and comp.sum() > 0.02 * W * H:
        sea |= comp
# Rocks and seagrass show through the shallows as dark mottling that is not
# blue at all. They are still sea: anything the water encloses is water.
sea = fill_holes(clean(sea, close_px=15))

# The river reaches the sea, so it arrives inside that same component. Wide
# water survives an erosion that a 10 m river does not: the difference is the
# river, plus the harbour's inner corners, which the area filter drops.
sea_core = cv2.erode(sea.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
sea_body = take(cv2.dilate(sea_core, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (35, 35))).astype(bool) & sea)
river = clean((water_like | sea) & ~sea_body, open_px=2, close_px=11)
river = take(np.logical_or.reduce([c for c in largest_components(river, n=0, min_px=1200)] or [np.zeros((H, W), bool)]))

# --- sand: bright and low-lying, in the strip between water and town --------
# Beach, road and quay are all the same grey here, and the beach touches the
# road, so neither colour nor connectivity separates them. Distance from the
# water does: a beach is the first 80 m of land, a road crosses that strip and
# then runs half a kilometre inland. The cost is that the seafront road reads
# as beach for the few metres it runs behind the sand, which the massing does
# not care about - both are flat ground.
dist_sea = ndimage.distance_transform_edt(~sea)
bright = (val > 150) & (sat < 75) & (hue < 40)
sand = clean(bright & (dist_sea < 85), open_px=7, close_px=13)
sand = take(np.logical_or.reduce([c for c in largest_components(sand, n=0, min_px=2500)] or [np.zeros((H, W), bool)]))

# --- vegetation: green, then split by how dark it is -------------------------
green = (hue >= 25) & (hue <= 90) & (sat > 40)
# Hillside shadow is neither green nor bright, but it is still hillside: dark
# low-saturation pixels surrounded by trees belong to the wood.
wood = clean(green & (val < 145), open_px=5, close_px=11)
shade = (val < 90) & (sat < 90) & cv2.dilate(wood.astype(np.uint8), np.ones((31, 31), np.uint8)).astype(bool)
forest = take(clean(wood | shade, open_px=5, close_px=13))
field = take(clean((green & (val >= 145)) | ((hue >= 10) & (hue < 28) & (sat > 55) & (val > 95)), open_px=5, close_px=9))

# The mountain is the forest at scale, not every hedge: keep components that
# are large enough to carry a ridge.
mountain = np.logical_or.reduce(
    [c for c in largest_components(forest, n=0, min_px=20000)] or [np.zeros((H, W), bool)]
)

# --- built: whatever is left, once the natural surfaces are spoken for -------
built = clean(~claimed, open_px=3, close_px=3)

# Roads and roofs are the same greys here, so colour cannot separate them.
# Texture can: a road surface is smooth over metres, while a roof carries a
# ridge, eaves and a shadow line at every edge.
grey = cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY)
tex = cv2.GaussianBlur(np.abs(cv2.Laplacian(grey, cv2.CV_32F, ksize=3)), (0, 0), 4)
if built.any():
    t_cut = float(np.percentile(tex[built], 35))
    v_cut = float(np.percentile(val[built], 45))
else:
    t_cut = v_cut = 0.0
road = clean(built & (tex < t_cut) & (val > v_cut) & (sat < 70), open_px=3, close_px=11)
road = np.logical_or.reduce([c for c in largest_components(road, n=0, min_px=6000)] or [np.zeros((H, W), bool)])

# No closing here: a 3 px close bridges the gap between two houses and the
# watershed then reports the terrace as one building.
buildings_mask = clean(built & ~road, open_px=3)
# Rock outcrops and gaps in the canopy are "not natural" too. Two things tell
# a roof from a rock: a roof is close to rectangular, and it stands by a road.
near_road = cv2.dilate(road.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (251, 251))).astype(bool)
# Rocks sit at the waterline; houses are set back from it.
buildings_mask &= near_road & (dist_sea > 25)


# --- vectorising -------------------------------------------------------------
def to_metres(x, y):
    """Image pixels -> local grid metres. North is up, so northing flips."""
    return [round((x - W / 2) * MPP, 1), round((H / 2 - y) * MPP, 1)]


def polygons(mask, min_area_m2, simplify_px=4.0):
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        if cv2.contourArea(c) * MPP * MPP < min_area_m2:
            continue
        approx = cv2.approxPolyDP(c, simplify_px, True).reshape(-1, 2)
        if len(approx) < 3:
            continue
        ring = [to_metres(x, y) for x, y in approx]
        ring.append(ring[0])
        out.append(ring)
    return out


def centrelines(mask, min_len_m=40.0, simplify_px=6.0):
    """Skeletonise, then walk the skeleton into simplified polylines."""
    skel = skeletonize(mask).astype(np.uint8)
    ys, xs = np.nonzero(skel)
    pts = set(zip(map(int, xs), map(int, ys)))
    if not pts:
        return []

    def nbrs(p):
        x, y = p
        return [
            q
            for q in (
                (x - 1, y - 1), (x, y - 1), (x + 1, y - 1),
                (x - 1, y), (x + 1, y),
                (x - 1, y + 1), (x, y + 1), (x + 1, y + 1),
            )
            if q in pts
        ]

    degree = {p: len(nbrs(p)) for p in pts}
    seeds = [p for p, d in degree.items() if d != 2] or [next(iter(pts))]
    used = set()
    lines = []
    for s in seeds:
        for first in nbrs(s):
            if (s, first) in used:
                continue
            path = [s, first]
            used.add((s, first))
            used.add((first, s))
            cur, prev = first, s
            while degree.get(cur, 0) == 2:
                nxt = [q for q in nbrs(cur) if q != prev]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                used.add((prev, cur))
                used.add((cur, prev))
                path.append(cur)
            if len(path) < 3:
                continue
            arr = np.array(path, dtype=np.int32).reshape(-1, 1, 2)
            length = cv2.arcLength(arr, False) * MPP
            if length < min_len_m:
                continue
            simple = cv2.approxPolyDP(arr, simplify_px, False).reshape(-1, 2)
            lines.append([to_metres(int(x), int(y)) for x, y in simple])
    return join_through_routes(lines)


def join_through_routes(lines, gap_m=70.0, turn_deg=55.0):
    """Sew the skeleton's edges back into routes.

    Skeletonising cuts a street at every junction, which is correct as a graph
    and useless as a way: the coast road came out as five stubs. A driver going
    straight on through a junction stays on the same road, so two ends that
    meet and continue in the same direction are one way.
    """

    def heading(a, b):
        return math.atan2(b[0] - a[0], b[1] - a[1])

    def turn(h1, h2):
        return abs((h1 - h2 + math.pi) % (2 * math.pi) - math.pi)

    routes = [list(l) for l in lines]
    merged = True
    while merged:
        merged = False
        for i in range(len(routes)):
            for j in range(len(routes)):
                if i == j or not routes[i] or not routes[j]:
                    continue
                a, b = routes[i], routes[j]
                # a's tail meeting b's head, with b's head reversed as needed
                for rev_a, rev_b in ((False, False), (False, True), (True, False), (True, True)):
                    aa = a[::-1] if rev_a else a
                    bb = b[::-1] if rev_b else b
                    if math.dist(aa[-1], bb[0]) > gap_m:
                        continue
                    if turn(heading(aa[-2], aa[-1]), heading(bb[0], bb[1])) > math.radians(turn_deg):
                        continue
                    routes[i] = aa + bb[1:]
                    routes[j] = []
                    merged = True
                    break
                if merged:
                    break
            if merged:
                break
    return [r for r in routes if r]


def footprints(mask, min_m2=25.0, max_m2=700.0, min_extent=0.55):
    """Oriented boxes, the shape src/data/gis already stores structures in.

    Houses in a fishing town share walls, so connected components return the
    block rather than the house. A watershed on the distance transform splits
    the block back at its narrow waists, which is where the party walls are.
    """
    dist = ndimage.distance_transform_edt(mask)
    peaks = peak_local_max(dist, min_distance=3, labels=mask, exclude_border=False)
    markers = np.zeros(dist.shape, np.int32)
    for n, (y, x) in enumerate(peaks, start=1):
        markers[y, x] = n
    labels = watershed(-dist, markers, mask=mask)
    out = []
    for i in range(1, labels.max() + 1):
        comp = (labels == i).astype(np.uint8)
        area_m2 = float(comp.sum()) * MPP * MPP
        if not (min_m2 <= area_m2 <= max_m2):
            continue
        cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        (cx, cy), (w, h), ang = cv2.minAreaRect(max(cnts, key=cv2.contourArea))
        if min(w, h) * MPP < 3.0 or max(w, h) > 8 * max(min(w, h), 1e-6):
            continue
        if area_m2 / max(w * h * MPP * MPP, 1e-6) < min_extent:
            continue
        # minAreaRect's angle is from the +x axis; the survey wants a compass
        # bearing for the long side, clockwise from north.
        if w < h:
            w, h = h, w
            ang += 90.0
        bearing = (90.0 - ang) % 180.0
        out.append(
            {
                "centre": to_metres(cx, cy),
                "bearingDeg": round(bearing, 1),
                "length": round(w * MPP, 1),
                "depth": round(h * MPP, 1),
                "area": round(area_m2, 1),
            }
        )
    return out


features = []


def add(geom_type, coords, **props):
    features.append({"type": "Feature", "properties": props, "geometry": {"type": geom_type, "coordinates": coords}})


for ring in polygons(sea_body, 2000, 6.0):
    add("Polygon", [ring], kind="sea")
for ring in polygons(sand, 300, 4.0):
    add("Polygon", [ring], kind="sand")
for ring in polygons(mountain, 4000, 6.0):
    add("Polygon", [ring], kind="forest")
for ring in polygons(field & ~mountain, 400, 4.0):
    add("Polygon", [ring], kind="field")
for line in centrelines(river, min_len_m=60.0):
    add("LineString", line, kind="river")
for line in centrelines(road, min_len_m=60.0):
    add("LineString", line, kind="road")
for b in footprints(buildings_mask):
    add(
        "Point",
        b["centre"],
        kind="building",
        bearingDeg=b["bearingDeg"],
        length=b["length"],
        depth=b["depth"],
        area=b["area"],
    )

geojson = {
    "type": "FeatureCollection",
    "properties": {
        "source": SRC.name,
        "note": "local tangent plane, metres; +x east, +y north; origin at image centre",
        "frame_m": FRAME_M,
        "metres_per_pixel": round(MPP, 4),
    },
    "features": features,
}
(DIR / "town.geojson").write_text(json.dumps(geojson, ensure_ascii=False))

# --- pictures to check it by ------------------------------------------------
LEGEND = {
    "sea": ((150, 90, 20), sea_body),
    "river": ((200, 140, 60), river),
    "sand": ((150, 210, 240), sand),
    "forest": ((40, 90, 40), mountain),
    "field": ((90, 190, 150), field & ~mountain),
    "road": ((230, 230, 230), road),
    "building": ((60, 60, 210), buildings_mask),
}
classes = np.zeros_like(bgr)
for colour, mask in LEGEND.values():
    classes[mask] = colour
cv2.imwrite(str(OUT / "classes.png"), classes)

overlay = bgr.copy()
for f in features:
    kind = f["properties"]["kind"]
    colour = LEGEND.get(kind, ((0, 0, 255), None))[0]
    g = f["geometry"]
    if g["type"] == "Polygon":
        pts = np.array([[int(x / MPP + W / 2), int(H / 2 - y / MPP)] for x, y in g["coordinates"][0]], np.int32)
        cv2.polylines(overlay, [pts], True, colour, 2, cv2.LINE_AA)
    elif g["type"] == "LineString":
        pts = np.array([[int(x / MPP + W / 2), int(H / 2 - y / MPP)] for x, y in g["coordinates"]], np.int32)
        cv2.polylines(overlay, [pts], False, colour, 3, cv2.LINE_AA)
    else:
        p = f["properties"]
        x, y = g["coordinates"]
        box = cv2.boxPoints((
            (x / MPP + W / 2, H / 2 - y / MPP),
            (p["length"] / MPP, p["depth"] / MPP),
            90.0 - p["bearingDeg"],
        ))
        cv2.polylines(overlay, [np.int32(box)], True, (60, 60, 210), 1, cv2.LINE_AA)
cv2.imwrite(str(OUT / "overlay.png"), overlay)

counts = {}
for f in features:
    counts[f["properties"]["kind"]] = counts.get(f["properties"]["kind"], 0) + 1
print(f"{SRC.name}  {W}x{H}  {MPP:.4f} m/px  frame {FRAME_M:.0f} m")
for k in sorted(counts):
    print(f"  {k:9s} {counts[k]:4d}")
areas = {
    k: float(m.sum()) * MPP * MPP / 10000
    for k, (_, m) in LEGEND.items()
    if m is not None
}
print("  area (ha): " + "  ".join(f"{k} {v:.1f}" for k, v in areas.items()))
print(f"wrote {DIR/'town.geojson'}, {OUT/'classes.png'}, {OUT/'overlay.png'}")
