# AGENTS.md — build a town

You are going to make a place that someone can walk around: a set of 360°
panoramas that agree with each other, joined by arrows that point where they
say they point, on a map that cannot drift away from the pictures.

Read this whole file before you run anything. The order of the steps is the
method; the gates between them are where the work is.

---

## 1. What you are building, and what "done" means

One town is one directory under `worlds/`. It holds a manifest, a graph of
places, a traced map of the ground, one scene description per place, and
nothing else. Everything the browser serves is generated from that.

A town is done when all three of these are true:

```
bun run test
bun scripts/verify-tour.ts http://localhost:4173 shots <worldId>
```

and **a human has looked at the contact sheet for every place**. The tests and
the browser check catch geometry; only a person catches a painting that is
wrong.

Scale, so you can plan: a town is roughly 8 to 25 places. Each outdoor place
costs at least one image generation and often three. Budget 30 to 60
generations for a town of eight places, including the aerial photograph.

**The aerial photograph is the most expensive decision in the project.**
Everything downstream inherits its frame. You cannot add a river in step 6.

---

## 2. Before you start

### 2.1 Tools

| tool | for |
|---|---|
| `bun` | everything under `scripts/` and the app |
| `uv` | `scripts/detect_landcover.py` (it declares its own dependencies) |
| chromium via playwright | `pano-gate.ts`, `verify-tour.ts` |

`bun install` once. The Python script needs nothing installed.

### 2.2 The image generator

The pipeline does not know which image model you use. It runs a command:

```
<command> --prompt-file <path> --out <path> [--ref <path>:<label>]... [--aspect <w:h>]
```

Copy `vstreat.config.example.json` to `vstreat.config.json` and point
`command` at your adapter. `adapters/README.md` says what an adapter has to
do; `adapters/codex.sh` is a worked one.

**Do not run two generations at once.** Concurrent calls collided and both
came back empty. One at a time.

### 2.3 Prove the plumbing for nothing first

`adapters/mock.sh` paints a wrapping gradient with a disc where the sun goes.
It costs nothing, and it tells "the plumbing is wrong" from "the prompt is
wrong". Run the chain on the town that ships, starting from its committed
trace:

```sh
export VSTREAT_IMAGE_GEN=./adapters/mock.sh
bun scripts/render-map.ts dragon --pins
bun scripts/stations.ts dragon
bun scripts/render-blockouts.ts dragon --all
bun scripts/gen-pano.ts dragon plaza --blockout worlds/dragon/raw/blockouts/plaza.png --suffix mock
bun run test
```

If every stage produced a file, your plumbing is right and every later failure
is about content. **The mock cannot stand in for the aerial photograph** — a
gradient traces into no roads and no buildings — so the free run starts from a
`town.geojson` that already exists.

---

## 3. The one rule: a town is a directory

```
worlds/<id>/
  world.json            identity, frame, terrain rules, light, style, counting rules
  aerial.prompt.txt     the prompt that paints the aerial photograph
  town.geojson          the traced ground, in metres. COMMITTED. You edit this by hand
  places.json           ids, names, captions, the link graph, and where each place stands
  survey.json           GENERATED. Only stations.ts --write writes it. Never hand-edit
  scenes/<node>.json    what each place looks like
  scenes/README.md      this town's shared vocabulary
  characters.json       residents, if any
  dialogue/<id>.json    what each resident says
  loop.json             an exhibit loop, if any
  raw/                  GITIGNORED. aerial.png, overlay.png, blockouts/, panoramas/

public/worlds/<id>/     GENERATED. map.jpg, panoramas/, pipeline/, characters/
```

Nothing about a town lives outside those two directories. Node ids only have
to be unique **within** a town. **Never write a town's name into a script.**

---

## 4. The method, in order

### 4.1 Declare the town → `world.json`

There is no scaffold command; write the file. Copy `worlds/dragon/world.json`
and change it.

Four things here are chosen by a human and cannot be checked by anything:

- **`frameM`** — how many metres across the aerial photograph is. It must be
  **1200**: the massing grid is 600 cells of 2 m, and `buildWorld` refuses any
  other number rather than quietly putting a flat plain beyond your town.
- **`terrain.ridgeM`** — how high the high ground stands. A nadir photograph
  carries no height, so elevation is *declared*, never detected.
  `terrain.ridgeFrom` names which traced cover it grows out of (the largest
  polygon of that kind), and `terrain.terraceFrom` names the low ground
  everything ramps up from — the water, usually.
- **`light`** — one light for the whole town, forever. Azimuth, elevation, the
  body ("sun", "moon") and a mood phrase. **Changing it after painting has
  started invalidates every panorama already painted.**
- **`style.outdoor` and `style.indoor`** — two paragraphs. Describe the style
  by its visual qualities. **Never name a studio or an artist.**

`continuity` is the list of things that must be counted right in every
painting: one light, one bridge, one fountain, water on one side and the ridge
on the other. Write the ones your town could get wrong.

### 4.2 Paint the aerial → GATE A

```sh
bun scripts/gen-aerial.ts <worldId>
```

Write `aerial.prompt.txt` so that **the topology you intend is visible from
directly above**. If you want a bridge there must be a river. If you want a
square there must be an open paved area large enough to trace.

**Colour is what separates one kind of ground from another when the photograph
is traced.** The detector works on hue and value, so say so in the prompt:
roofs distinctly darker and cooler than any vegetation, streets clearly
lighter than roofs, water saturated, fields a different green from woodland.
Terracotta roofs read as fields.

**GATE A — your own eyes.** Open `worlds/<id>/raw/aerial.png`.

- Is it nadir — looking straight down, no facades, nothing leaning?
- Is north up, and is it square?
- Is every kind of place your place list needs actually visible?

**If not, paint it again.** Three to six attempts is normal. This is the one
step where repainting is cheaper than any amount of work downstream.

### 4.3 Trace it → GATE B

```sh
uv run scripts/detect_landcover.py <worldId>
```

**The trace is a draft.** Roads that stop mid-block, buildings merged into
one, a river traced as three stubs: all normal.

**GATE B — your own eyes, on `worlds/<id>/raw/overlay.png`**, which is the
vectors drawn back over the photograph. `worlds/<id>/town.geojson` is plain
GeoJSON in metres and **you are expected to edit it by hand.** This is a step,
not a fallback, and it is where you add the most value.

What the shipped town needed, as a guide to the normal amount:

- its river came out as `sea`, because the thresholds were written against a
  coastline. Relabelled to `river`.
- its pale stone bridge road came out as `sand`. Deleted.
- a three-point `river` inside the town was the fountain. Deleted.
- **every building footprint was grown by half.** The watershed shrinks each
  roof in a packed quarter, so the massing showed a clearing where the
  photograph shows a street eight metres wide. This one is easy to miss
  because the trace *looks* right in the overlay; you find it at GATE E.

If the photograph genuinely does not show the town you wanted, go back to 4.2.

### 4.4 Build the terrain → GATE C

```sh
bun scripts/render-map.ts <worldId> --pins
```

**GATE C — a printout, not a picture.** It lists the area of each land class
and, once you have sited your places, the ground height and land class under
every station.

- Does the declared ridge match the built one, roughly?
- Is the water water, and is the flat ground flat?
- **A station reported as standing `on building` or on water is wrong, and no
  amount of prompting fixes it.** An *indoor* station reported `on building`
  is correct — that is what being indoors means.

`bun scripts/grid.ts <worldId> <e> <n> [radius]` prints the land classes
around a point as text. It is the only tool that lets you *read* the massing
instead of looking at a picture of it, and it is how you find a spot that is
actually enclosed.

### 4.5 Site the places → `places.json`

Each place gets `id`, `name`, `caption`, `indoor`, `links` and a `site`:

- `{ "kind": "road", "road": 0, "t": 0.45 }` — a fraction along a traced road
  centreline, numbered longest first. The heading follows the road, so an
  arrival faces along the street.
- `{ "kind": "point", "e": 30, "n": 105, "heading": 25 }` — metres on the
  local grid and a declared heading.
- `{ "kind": "indoor", "host": "<outdoor id>", "offset": {"e":25,"n":-8}, "heading": 288 }`
  — a room, positioned relative to the outdoor place it is entered from.

**Site against the massing, not against the photograph.** Four of the shipped
town's eight places had to move after GATE C and GATE E: two stood inside
buildings, one stood beside its street instead of on it, and one stood in the
open where the photograph shows a lane. Use `grid.ts` first.

**Name places by geography, not by their position along a polyline.** A
polyline's direction is an accident of tracing; calling its first station
"west" once put the west panorama on the east side's massing with its heading
30° out.

### 4.6 Derive the stations → GATE D

```sh
bun scripts/stations.ts <worldId> --write     # writes worlds/<id>/survey.json
bun run test
```

**Never hand-edit `survey.json`.** Edit `places.json` and derive it again.

**GATE D — the test suite, against derived geometry.** The one that will catch
you is arrow separation: two links on the same place must be more than π/4
apart, or the tour plugin fades one of them out. **Two places closer than
about 20 m on a straight street will fail it — that is the test telling you
they are the same place.** Move one, or merge them.

### 4.7 Render the blockouts → GATE E

```sh
bun scripts/render-blockouts.ts <worldId> --all
```

A blockout is the massing raycast to an equirectangular image from the
station's own eye, facing its own heading — **the same projection as the
painting you are about to make**, so nothing has to be mentally projected.

**GATE E — your own eyes, one per outdoor place.** Does it show the place you
meant? How wide does the street read, how high is the horizon, where is the
mass, where is the light disc? Indoor places get no blockout by design.

If a street reads as a clearing, the footprints are too small — go back to
4.3. If the camera is in the wrong spot, go back to 4.5.

### 4.8 Write the scenes → `scenes/<node>.json`

Two forms. Outdoors use `bearings`, six directions of one continuous place:

```json
{
  "subject": "...",
  "camera": "where the camera stands, and how wide the space is",
  "bearings": { "ahead": "...", "right": "...", "behind": "...", "left": "...", "up": "...", "down": "..." }
}
```

Indoors may use a single `scene` paragraph instead, because the walls of a
room tell the model what shape it is — **but see the warning in 4.11.**

The rules, which are hard-won:

1. **Read the bearings off the blockout**, not out of your head.
2. **Name what lies between things.** Water never meets a road along a bare
   line: say what the bank is.
3. **Nothing ends within sight.** A street leaves the frame or turns a corner.
4. **Do not mention the light, the time of day or the weather.** The light
   paragraph is generated from the survey and appended for you.
5. **Do not write style into a scene.** The style is the town's.
6. **Keep a vocabulary list in `scenes/README.md` and paste the same phrase
   for the same object into every scene that sees it.** This is the only thing
   that makes the same houses come out as the same houses.

### 4.9 Paint the panoramas → GATES F, G, H

```sh
bun scripts/gen-pano.ts <worldId> <node> --blockout worlds/<worldId>/raw/blockouts/<node>.png
```

**Paint the hub of the town first, then chain outward**, handing each finished
neighbour to the next:

```sh
bun scripts/gen-pano.ts <worldId> <next> \
  --blockout worlds/<worldId>/raw/blockouts/<next>.png \
  --neighbour public/worlds/<worldId>/panoramas/<hub>.jpg:"fifty metres back down this same street, facing away from you"
```

Indoor rooms take `--context <host panorama>:"what can be seen out of the
door"` instead of a blockout.

**GATE F — automatic, inside `gen-pano.ts`.** It measures how badly the left
and right edges fail to join, against how busy the image is. Under the limit
it passes; a little over, it feathers 48 px each side; well over, it paints
again, up to three attempts. Failing all three means the scene is asking for
something the model cannot close — usually a hard vertical boundary sitting on
the seam.

**GATE G — one number.**

```sh
bun scripts/sun-check.ts <worldId> <node>
```

25° of azimuth error passes. To calibrate: the shipped town came in at −2,
−13, −8, +14 and −5 degrees with a blockout, and at **117 degrees with a
neighbour attached**.

> **A neighbour reference overrides the blockout's light.** The neighbour
> carries a light of its own, and the model copies that relationship instead
> of the disc in the blockout. The alley measured 117° off; repainted from the
> same blockout with no neighbour, the same scene came back at 6°. So the
> neighbour buys continuity and costs the light, and for a scene with little
> sky it costs all of it. Chain outward for the places whose continuity
> matters, and drop the neighbour when the light matters more.

The check finds the brightest point of the sky band. **In a lane or a covered
street most of that band is wall and there may be no light in frame at all**;
it says so when the brightest sky is too dim to be a light, and then only the
contact sheet can answer.

**GATE H — the one that decides. Your own eyes.**

```sh
bun scripts/pano-gate.ts <url> gate.jpg
```

Twelve frames, yaw 0/90/180/270 × pitch 0/±45, in one sheet. Looking for:

- four genuinely different views, not the same facade four times
- no step in vertical structures at the wrap
- verticals staying vertical out to the left and right edges
- no smearing or missing pixels at the poles

`pano-check.ts` is only a screen. **A flat wide-angle landscape with sky above
and ground below passes it.** It is necessary and not sufficient.

### 4.10 Build the app data → GATES I and J

```sh
bun scripts/render-map.ts <worldId>        # the shipped minimap, from the same world
bun scripts/export-pipeline.ts <worldId>   # the making-of stages, if world.json declares a pipeline
bun run test                               # GATE I
bun run build && bun run preview
bun scripts/verify-tour.ts http://localhost:4173 shots <worldId>   # GATE J
```

The minimap is **rendered from the same heightfield the panoramas came from**,
never generated by a model: an image model put a school on the wrong side of a
railway, and a map that disagrees with the panoramas is worse than no map.

`world.json`'s `map.width` and `map.height` must match what `render-map.ts`
writes (1200 × 1200). Declaring 1254 put every hotspot out by 4.5%.

**GATE J** drives a real browser: the panorama renders, dragging turns a full
360°, an arrow moves you, the minimap cone tracks and recentres, a hotspot
navigates, outdoor → indoor works, the back button returns you, and the page
logs no errors.

### 4.11 Residents — optional

`characters.json` places a resident at a node: `at` is a fraction of the
panorama's width, `pitch` is where their feet are, `line` is what they say
when the tour faces them. Their sprite is `public/worlds/<id>/characters/<resident
id>.png`, named after them, and `dialogue/<resident id>.json` is what they say
when spoken to — a persona, an opening, some choices and a farewell.

```sh
bun scripts/gen-character.ts <worldId> <characterId>   # prompt in worlds/<id>/raw/characters/<id>.prompt.txt
```

Ask for the figure on a flat `#00ff00` background; the pipeline keys it out and
bakes a contact shadow. A resident must stand more than π/4 from every arrow
on their node, and the tests enforce it.

> **Paint interiors with `bearings`, not a prose `scene`.** A room painted from
> prose puts its door wherever the model likes, while the arrow out of it is
> fixed by geometry. For a room with one opening you can reconcile them by
> choosing the station's `heading` — an indoor heading is never used in its
> prompt, so it is free. For a room with two you cannot: the shipped inn's
> taproom has its door and its staircase 47° apart in the picture, which fixes
> where the guest room must be, and that direction leaves the building. Its
> door lines up and its staircase does not.

---

## 5. The judgement calls only a human makes

1. `frameM` and `terrain.ridgeM` — declared, never measured.
2. Which places exist, and where they stand, including the ~20 m minimum
   spacing that GATE D enforces.
3. Editing `town.geojson` when the detector was wrong. It usually is,
   somewhere.
4. Reading bearings off a blockout.
5. The order of the neighbour chain, and where to break it for the light.
6. The shared vocabulary.
7. When a painting is good enough.

---

## 6. Every gate, in one table

| gate | how | passes when |
|---|---|---|
| A | look at `raw/aerial.png` | nadir, north up, square, every kind of place visible |
| B | look at `raw/overlay.png`, edit `town.geojson` | the vectors are the town you meant |
| C | `render-map.ts <id> --pins` | no outdoor station on a building or on water; ridge as declared |
| D | `bun run test` | links reciprocal, reachable, and more than π/4 apart |
| E | look at `raw/blockouts/*.png` | each shows the place you meant, at the width you meant |
| F | automatic in `gen-pano.ts` | the wrap joins, or joins after feathering |
| G | `sun-check.ts <id> <node>` | azimuth error ≤ 25° |
| H | `pano-gate.ts <url> out.jpg` | four different views, no seam step, verticals vertical, poles clean |
| I | `bun run test` | every invariant, and every prompt in the town builds |
| J | `verify-tour.ts <url> <dir> <id>` | all checks pass, no page errors |

---

## 7. When a gate fails

| failed | go back to |
|---|---|
| A | 4.2, paint the aerial again |
| B | 4.3, edit the GeoJSON — or 4.2 if the photograph is wrong |
| C | 4.5 to re-site, or 4.3 to fix the trace |
| D | 4.5, move or merge places |
| E | 4.3 if the mass is wrong, 4.5 if the camera is |
| F | 4.8, the scene is asking for an unclosable seam |
| G | 4.9, paint again without the neighbour |
| H | 4.8 and 4.9 — this is the one that means the picture is wrong |
| I, J | whichever data the message names |

---

## 8. Never

- Never write an absolute path anywhere.
- Never hand-edit `survey.json`.
- Never write style, light or projection text into a scene file.
- Never hardcode a town's id in `scripts/`.
- Never change `light` after painting has started.
- Never accept a panorama on `pano-check` alone.
- Never name a studio or an artist in a style paragraph.
- Never run two generations at the same time.

---

## 9. Reference: scripts

| script | what |
|---|---|
| `gen-aerial.ts <id>` | paint the aerial photograph |
| `detect_landcover.py <id>` | trace it into `town.geojson` (`uv run`) |
| `render-map.ts <id> [--pins]` | the shipped minimap; `--pins` the debug copy and the class/station report |
| `grid.ts <id> <e> <n> [r]` | the massing around a point, as text |
| `stations.ts <id> [--write]` | derive the survey from `places.json` |
| `render-blockouts.ts <id> <node\|--all>` | massing raycast to equirectangular |
| `gen-pano.ts <id> <node> [--blockout p] [--neighbour p:where] [--context p:where] [--suffix s]` | paint one place |
| `prep-pano.ts <in> <out.jpg>` | centre-crop to an exact 2:1 sphere and encode |
| `seam-feather.ts <in> <out> [px]` | cross-blend the wrap |
| `pano-check.ts <image>` | the cheap screen |
| `pano-gate.ts <url> <out.jpg>` | the twelve-frame contact sheet |
| `sun-check.ts <id> <node>` | where the light landed, against the survey |
| `export-pipeline.ts <id>` | the making-of stages for the viewer |
| `verify-tour.ts <url> <dir> <id>` | end-to-end in a real browser |
| `gen-character.ts <id> <char>` | paint a resident, key it out, bake its shadow |
| `chroma-key.ts <src> <dest>` / `bake-shadow.ts <sprite>` | the two steps of that, separately |
| `record-loop.ts <url> <out.webm> [ms]` | record one pass of a town's `loop.json`; the url wants `?w=<id>&loop=1` |
| `licenses.ts` | regenerate `THIRD-PARTY-LICENSES.txt` |

`bun run test`, `bun run typecheck`, `bun run lint`, `bun run dev`,
`bun run build`, `bun run preview`, `bun run verify`.

---

## 10. Reference: file formats

Read the shipped town: `worlds/dragon/` is a complete, working example of
every file named in §3, and `worlds/dragon/scenes/README.md` shows what a
vocabulary list looks like.

---

## 11. Publishing your town

`bun run build` produces a static site in `dist/`, which any static host will
serve. `wrangler.jsonc` is set up for Cloudflare Workers static assets if that
is what you use: `bun run deploy`. It deliberately carries no account id -
wrangler reads `CLOUDFLARE_ACCOUNT_ID` from your environment - and no
`routes`, so add your own block there for a custom domain.

The panoramas and sprites you generate are your model's output. Say so
wherever you publish them, and check what your provider's terms allow.
