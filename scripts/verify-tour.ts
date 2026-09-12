#!/usr/bin/env bun
/**
 * End-to-end check of one world in a real browser: the panorama renders,
 * dragging turns the view all the way round, a ground arrow moves you to the
 * next place, the minimap pin and cone track the view and recentre as you move,
 * a minimap hotspot navigates, and the outdoor -> indoor step works.
 *
 *   bun scripts/verify-tour.ts http://localhost:4173 shots dragon
 *
 * Every place-specific id is derived from the world definition, so this works
 * for any town rather than only the one it was written against.
 */
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { loadCharacters, WORLDS } from './lib/worlds.ts';

const url = process.argv[2] ?? 'http://localhost:4173';
const shotDir = process.argv[3] ?? 'verify-shots';
const worldId = process.argv[4] ?? WORLDS[0].id;

const world = WORLDS.find((w) => w.id === worldId);
if (!world) throw new Error(`unknown world "${worldId}" (have: ${WORLDS.map((w) => w.id).join(', ')})`);

// Derive the interesting places from the graph rather than naming them.
const everyLink = world.nodes.flatMap((n) => n.links.map((l) => ({ from: n.id, to: l.nodeId })));
// The outdoor -> indoor step is the hardest transition, so prefer it. A town
// with no interiors still has to survive walking through an arrow, though, so
// fall back to any link rather than refusing to check the world at all.
const step =
  everyLink.find(
    ({ from, to }) =>
      !world.nodes.find((n) => n.id === from)?.indoor && world.nodes.find((n) => n.id === to)?.indoor,
  ) ?? everyLink[0];
if (!step) throw new Error(`${world.id} has no link to walk`);
const stepIsIndoor = world.nodes.find((n) => n.id === step.to)?.indoor ?? false;

const busiest = [...world.nodes].sort((a, b) => b.links.length - a.links.length).slice(0, 2);
const farApart = [world.startNodeId, [...world.nodes].reverse()[0].id];

type Psv = {
  getPosition: () => { yaw: number; pitch: number };
  getPlugin: (id: string) => unknown;
  rotate: (p: { yaw: string | number; pitch: string | number }) => void;
};

const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const currentNode = (page: Page) =>
  page.evaluate(() => {
    const tour = (window as never as { psv: Psv }).psv.getPlugin('virtual-tour') as {
      getCurrentNode: () => { id: string };
    };
    return tour.getCurrentNode().id;
  });

const waitForNode = async (page: Page, from: string, ms = 12_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await currentNode(page)) !== from) return true;
    await page.waitForTimeout(200);
  }
  return false;
};

const goTo = async (page: Page, id: string) => {
  await page.evaluate((n: string) => {
    const tour = (window as never as { psv: Psv }).psv.getPlugin('virtual-tour') as {
      setCurrentNode: (i: string) => void;
    };
    tour.setCurrentNode(n);
  }, id);
  await page.waitForTimeout(2600);
};

/** Mean absolute pixel difference between two PNG buffers of equal size. */
async function diff(a: Buffer, b: Buffer): Promise<number> {
  const [x, y] = await Promise.all([
    sharp(a).greyscale().raw().toBuffer(),
    sharp(b).greyscale().raw().toBuffer(),
  ]);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean((window as never as { psv?: unknown }).psv), null, {
  timeout: 30_000,
});
await page.waitForTimeout(3500);
await Bun.$`mkdir -p ${shotDir}`.quiet();

// 0. reach the world under test the way a user would - via the switcher
if (world.id !== WORLDS[0].id) {
  await page.getByRole('button', { name: world.label, exact: true }).click();
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => Boolean((window as never as { psv?: unknown }).psv), null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(3500);
}
check(
  `world switcher reaches ${world.label}`,
  (await currentNode(page)) === world.startNodeId,
  `at ${await currentNode(page)}`,
);

// register once; used to identify arrows by hovering them
await page.evaluate(() => {
  const tour = (window as never as { psv: Psv }).psv.getPlugin('virtual-tour') as {
    addEventListener: (t: string, cb: (e: { link: { nodeId: string } }) => void) => void;
  };
  tour.addEventListener('enter-arrow', (e) => {
    (window as never as { __arrow?: string }).__arrow = e.link.nodeId;
  });
});

/**
 * Arrow elements carry no node id, only a CSS3D transform, so identify them the
 * way a user does: hover each one and read the link from the enter-arrow event.
 */
async function findArrow(target: Page, nodeId: string) {
  const arrows = target.locator('.psv-virtual-tour-link');
  for (let i = 0; i < (await arrows.count()); i++) {
    const box = await arrows.nth(i).boundingBox();
    if (!box) continue;
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    await target.evaluate(() => delete (window as never as { __arrow?: string }).__arrow);
    // enter-arrow only fires on entry, so leave first - otherwise a cursor left
    // sitting on this arrow from the previous probe reports nothing at all.
    await target.mouse.move(4, 4);
    await target.mouse.move(cx, cy);
    await target.waitForTimeout(250);
    if ((await target.evaluate(() => (window as never as { __arrow?: string }).__arrow)) === nodeId) {
      return { x: cx, y: cy };
    }
  }
  return null;
}

// 1. the panorama actually rendered something
const first = await page.screenshot();
const blank = await sharp({
  create: { width: 1280, height: 800, channels: 3, background: '#202124' },
}).png().toBuffer();
const rendered = await diff(first, blank);
check('panorama renders', rendered > 20, `mean delta ${rendered.toFixed(1)} vs empty background`);
await sharp(first).jpeg({ quality: 85 }).toFile(`${shotDir}/${world.id}-01-start.jpg`);

// 2. dragging turns the view, and it can go all the way round
const startYaw = await page.evaluate(() => (window as never as { psv: Psv }).psv.getPosition().yaw);
await page.mouse.move(640, 400);
await page.mouse.down();
for (let x = 640; x >= 260; x -= 20) await page.mouse.move(x, 400);
await page.mouse.up();
await page.waitForTimeout(600);
const dragged = await page.evaluate(() => (window as never as { psv: Psv }).psv.getPosition().yaw);
check('drag rotates the view', Math.abs(dragged - startYaw) > 0.05, `yaw ${startYaw.toFixed(2)} -> ${dragged.toFixed(2)}`);

const seenYaws: number[] = [];
for (const deg of [0, 90, 180, 270, 359]) {
  await page.evaluate((d) => (window as never as { psv: Psv }).psv.rotate({ yaw: `${d}deg`, pitch: '0deg' }), deg);
  await page.waitForTimeout(250);
  seenYaws.push(await page.evaluate(() => (window as never as { psv: Psv }).psv.getPosition().yaw));
}
const spread = Math.max(...seenYaws) - Math.min(...seenYaws);
check('view turns a full 360', spread > 5.5, `yaw span ${spread.toFixed(2)} rad (2π ≈ 6.28)`);

// 3. the minimap cone follows the view
const mapBox = await page.locator('.psv-map__container').first().boundingBox();
let coneMoved = 0;
if (mapBox) {
  await page.evaluate(() => (window as never as { psv: Psv }).psv.rotate({ yaw: '0deg', pitch: '0deg' }));
  await page.waitForTimeout(500);
  const a = await page.screenshot({ clip: mapBox });
  await page.evaluate(() => (window as never as { psv: Psv }).psv.rotate({ yaw: '180deg', pitch: '0deg' }));
  await page.waitForTimeout(500);
  const b = await page.screenshot({ clip: mapBox });
  coneMoved = await diff(a, b);
  await sharp(b).jpeg({ quality: 90 }).toFile(`${shotDir}/${world.id}-02-minimap.jpg`);
}
check('minimap cone tracks the view', mapBox !== null && coneMoved > 1, `delta ${coneMoved.toFixed(2)} between opposite headings`);

// 4. clicking a ground arrow moves to the linked place.
// In 3D mode the arrows are CSS3DRenderer DOM buttons in their own container -
// they are NOT drawn at the link's spherical position, so projecting
// link.position and clicking there lands on the panorama behind them.
const before = await currentNode(page);
const anyArrow = await page.locator('.psv-virtual-tour-link').first().boundingBox();
if (anyArrow) await page.mouse.click(anyArrow.x + anyArrow.width / 2, anyArrow.y + anyArrow.height / 2);
const arrowWorked = anyArrow ? await waitForNode(page, before) : false;
check('ground arrow navigates', arrowWorked, anyArrow ? `${before} -> ${await currentNode(page)}` : 'no arrow element found');
await sharp(await page.screenshot()).jpeg({ quality: 85 }).toFile(`${shotDir}/${world.id}-03-after-arrow.jpg`);

// 5. clicking a minimap hotspot navigates.
// Two traps: the current node has a hotspot of its own (clicking it is a no-op
// that looks exactly like a broken minimap), and hotspotPos contains every node
// including ones whose position falls outside the small minimap.
const beforeMap = await currentNode(page);
const spot = await page.evaluate((here: string) => {
  const plugin = (window as never as { psv: Psv }).psv.getPlugin('map') as {
    component: { state: { hotspotPos: Record<string, { x: number; y: number }> } };
  };
  const rect = document.querySelector('.psv-map__container')?.getBoundingClientRect();
  if (!rect) return null;
  const pick = Object.entries(plugin.component.state.hotspotPos ?? {}).find(
    ([id, p]) =>
      !id.includes(here) &&
      p.x > rect.left + 4 && p.x < rect.right - 4 &&
      p.y > rect.top + 4 && p.y < rect.bottom - 4,
  );
  return pick ? { id: pick[0], ...pick[1] } : null;
}, beforeMap);
if (spot) await page.mouse.click(spot.x, spot.y);
const mapWorked = spot ? await waitForNode(page, beforeMap) : false;
check('minimap hotspot navigates', mapWorked, spot ? `${beforeMap} -> ${await currentNode(page)}` : 'no hotspot inside the minimap');

// 6. walking through an arrow (indoors where the world has an inside)
await goTo(page, step.from);
const atOutdoor = await currentNode(page);
const indoorArrow = await findArrow(page, step.to);
if (indoorArrow) {
  await page.mouse.click(indoorArrow.x, indoorArrow.y);
  await waitForNode(page, atOutdoor);
}
const landedAt = await currentNode(page);
// Assert where we ended up, not merely that something changed - an arrow that
// takes you back outside would otherwise pass this.
check(
  `${step.from} -> ${step.to}${stepIsIndoor ? ' (indoor)' : ''}`,
  atOutdoor === step.from && landedAt === step.to,
  `${atOutdoor} -> ${landedAt}${indoorArrow ? '' : ' (arrow not found)'}`,
);
await sharp(await page.screenshot()).jpeg({ quality: 85 }).toFile(`${shotDir}/${world.id}-04-indoor.jpg`);

// 7. the back button returns to where you came from
const beforeBack = await currentNode(page);
const backButton = page.getByRole('button', { name: 'ひとつ前の場所に戻る' });
const hasBack = (await backButton.count()) > 0;
if (hasBack) {
  await backButton.click();
  await waitForNode(page, beforeBack);
}
const afterBack = await currentNode(page);
check('back button returns to the previous place', hasBack && afterBack === step.from, `${beforeBack} -> ${afterBack}`);

// 8. the minimap recentres on the place you are actually standing.
// The cone rotating only proves it tracks heading, not position.
let recentred = 0;
if (mapBox) {
  await goTo(page, farApart[0]);
  const a = await page.screenshot({ clip: mapBox });
  await goTo(page, farApart[1]);
  const b = await page.screenshot({ clip: mapBox });
  recentred = await diff(a, b);
}
check('minimap recentres on the current place', recentred > 10, `delta ${recentred.toFixed(2)} between ${farApart.join(' and ')}`);

// 9. the drawn arrow agrees with the yaw the link declares, and no two arrows
// sit so close that the plugin hides one (linkOverlapAngle, default PI/4).
//
// Scope: this does NOT prove an arrow points at a real street opening - that
// depends on yawFromImageX being right, and an arrow is drawn at its declared
// yaw either way. Whether the openings line up is checked by eye.
const offsets: string[] = [];
for (const node of busiest) {
  await goTo(page, node.id);
  for (const link of node.links) {
    await page.evaluate((y: number) => {
      (window as never as { psv: Psv }).psv.rotate({ yaw: y, pitch: '0deg' });
    }, link.position.yaw);
    await page.waitForTimeout(500);
    const found = await findArrow(page, link.nodeId);
    offsets.push(found ? `${node.id}->${link.nodeId}:${Math.round(found.x - 640)}px` : `${node.id}->${link.nodeId}:hidden`);
  }
}
// A hidden arrow must fail. Scoring it 0 would let the very thing this check
// exists to catch - an arrow faded out for overlapping its neighbour - pass.
const hidden = offsets.filter((o) => o.endsWith('hidden'));
const worst = Math.max(0, ...offsets.filter((o) => !o.endsWith('hidden')).map((o) => Math.abs(parseInt(o.split(':')[1], 10))));
check('every arrow is visible and drawn at the heading it claims', hidden.length === 0 && worst < 190, `${offsets.join(' ')} (max |dx| ${worst}px)`);

// 10. arriving faces the way you were walking.
// The plugin carries the departing yaw across by default, which only lands
// right when both panoramas are oriented the same way in the world. Between
// two places whose headings are 180 apart, you arrive dead backwards.
const walkFrom = world.nodes.find((n) => n.links.length > 0)!;
const walkTo = walkFrom.links[0].nodeId;
await goTo(page, walkFrom.id);
const forwardArrow = await findArrow(page, walkTo);
if (forwardArrow) {
  await page.mouse.click(forwardArrow.x, forwardArrow.y);
  await waitForNode(page, walkFrom.id);
  await page.waitForTimeout(1600);
}
const arrivedYaw = await page.evaluate(() => (window as never as { psv: Psv }).psv.getPosition().yaw);
// Where we came from must now be behind us: the back-link should sit about
// half a turn from where we are looking.
const backYaw = world.nodes.find((n) => n.id === walkTo)?.links.find((l) => l.nodeId === walkFrom.id)?.position.yaw;
const offBy =
  backYaw === undefined
    ? Number.NaN
    : Math.abs(((((arrivedYaw - (backYaw + Math.PI)) * 180) / Math.PI + 540) % 360) - 180);
check(
  'arriving faces the way you were walking',
  Number.isFinite(offBy) && offBy < 25,
  `${walkFrom.id} -> ${walkTo}: ${offBy.toFixed(0)}° from straight ahead`,
);

// 11. a shared link opens where it says, and the address bar keeps up.
// Deep-linking is only useful if the link survives a round trip, so this loads
// one and reads back what the viewer actually did with it.
const deep = world.nodes.find((n) => n.id !== world.startNodeId) ?? world.nodes[0];
const link = `${url}?w=${world.id}&n=${deep.id}&y=123.4&p=-7.5&z=44`;
await page.goto(link, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean((window as never as { psv?: unknown }).psv), null, { timeout: 30_000 });
await page.waitForTimeout(4000);

const landed = await currentNode(page);
const aim = await page.evaluate(() => {
  const psv = (window as never as { psv: Psv & { getZoomLevel: () => number } }).psv;
  const p = psv.getPosition();
  return { yaw: (p.yaw * 180) / Math.PI, pitch: (p.pitch * 180) / Math.PI, zoom: psv.getZoomLevel() };
});
const off = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
check(
  'a shared link opens at the place and heading it names',
  landed === deep.id && off(aim.yaw, 123.4) < 3 && Math.abs(aim.pitch - -7.5) < 3 && Math.abs(aim.zoom - 44) < 3,
  `${landed} yaw ${aim.yaw.toFixed(1)} pitch ${aim.pitch.toFixed(1)} zoom ${aim.zoom.toFixed(0)} (asked ${deep.id} 123.4 / -7.5 / 44)`,
);

// Looking somewhere else must be reflected back into the address bar.
await page.evaluate(() => (window as never as { psv: Psv }).psv.rotate({ yaw: '250deg', pitch: '5deg' }));
await page.waitForTimeout(1200);
const written = await page.evaluate(() => window.location.search);
const wroteYaw = Number(new URLSearchParams(written).get('y'));
check(
  'the address bar follows the view',
  off(wroteYaw, 250) < 3,
  `after turning to 250°, the link says y=${Number.isFinite(wroteYaw) ? wroteYaw : '?'}`,
);

// 12. the pipeline stages swap what the visitor sees: the map shows the aerial
// photo and the GIS overlay full-screen, the 3D stage puts the massing render
// in the sphere from the same camera, and walking on while in 3D keeps it 3D.
if (world.pipeline) {
  const pipeline = world.pipeline;
  const view = () =>
    page.evaluate(() => {
      const psv = (window as never as { psv: Psv & { config: { panorama: string } } }).psv;
      const map = psv.getPlugin('map') as { config: { imageUrl: string } };
      return {
        panorama: psv.config.panorama,
        mapImage: map.config.imageUrl,
        mapLarge: document.querySelector('.psv-map--maximized') !== null,
      };
    });
  const stage = async (key: string) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(1500);
    return view();
  };
  const here = await currentNode(page);
  const three = await stage('3');
  const one = await stage('1');
  const two = await stage('2');
  const four = await stage('4');
  check(
    'pipeline stages swap the map and the sphere',
    three.panorama === pipeline.blockouts[here] &&
      !three.mapLarge &&
      one.mapImage === pipeline.aerial &&
      one.mapLarge &&
      two.mapImage === pipeline.overlay &&
      two.mapLarge &&
      four.panorama === world.nodes.find((n) => n.id === here)?.panorama &&
      four.mapImage === pipeline.massing &&
      !four.mapLarge,
    `3D: ${three.panorama} | aerial: ${one.mapImage} ${one.mapLarge ? 'large' : 'small'} | GIS: ${two.mapImage} | street: ${four.panorama}`,
  );

  await stage('3');
  const next = world.nodes.find((n) => n.id === here)?.links[0]?.nodeId;
  if (next) {
    await page.evaluate((id) => {
      const tour = (window as never as { psv: Psv }).psv.getPlugin('virtual-tour') as { setCurrentNode: (id: string) => void };
      tour.setCurrentNode(id);
    }, next);
    await page.waitForTimeout(3500);
    const walked = await view();
    check(
      'walking on in the 3D stage shows the next massing render',
      (await currentNode(page)) === next && walked.panorama === pipeline.blockouts[next],
      `${here} -> ${next}: ${walked.panorama}`,
    );
    await page.screenshot({ path: `${shotDir}/${world.id}-pipeline-3d.jpg`, quality: 70 });
  }
  await stage('4');
}

// 13. talking to a resident: the adventure-game window opens with their name
// and first line, the ground arrows step aside, Space advances, Escape closes.
{
  const resident = loadCharacters(world.id)[0];
  if (resident) {
    await page.goto(`${url}/?w=${world.id}&n=${resident.nodeId}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean((window as never as { psv?: unknown }).psv), null, { timeout: 30_000 });
    await page.waitForTimeout(800);
    await page.evaluate((id) => (window as never as { vstreet: { talk: (id: string) => void } }).vstreet.talk(id), resident.id);
    await page.waitForTimeout(2500);
    const opened = await page.evaluate(() => ({
      dialog: document.querySelector('[role="dialog"]') !== null,
      name: document.querySelector('[role="dialog"] .bg-amber-300')?.textContent ?? '',
      text: document.querySelector('[data-testid="dialogue-text"]')?.textContent ?? '',
      arrows: getComputedStyle(document.querySelector('.psv-virtual-tour-arrows')!).display,
    }));
    await page.keyboard.press('Space');
    await page.waitForTimeout(2500);
    const second = (await page.locator('[data-testid="dialogue-text"]').textContent()) ?? '';
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => ({
      dialog: document.querySelector('[role="dialog"]') !== null,
      arrows: getComputedStyle(document.querySelector('.psv-virtual-tour-arrows')!).display,
    }));
    await page.screenshot({ path: `${shotDir}/${world.id}-dialogue.jpg`, quality: 70 });
    check(
      'a resident answers in the dialogue window',
      opened.dialog && opened.name === resident.name && opened.text.length > 0 && opened.arrows === 'none' && second !== opened.text && !closed.dialog && closed.arrows !== 'none',
      `${resident.name}: "${opened.text.slice(0, 24)}" then "${second.slice(0, 24)}"; arrows ${opened.arrows} while open, ${closed.arrows} after`,
    );
  }
}

check('no page errors', errors.length === 0, errors.length ? [...new Set(errors)].join(' | ') : 'none');

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n[${world.id}] ${results.length - failed.length}/${results.length} checks passed, shots in ${shotDir}/`);
process.exit(failed.length ? 1 : 0);
