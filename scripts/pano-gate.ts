#!/usr/bin/env bun
/**
 * Step 1 gate, part (b): the check that actually decides.
 *
 * Drives the live viewer through yaw 0/90/180/270 x pitch 0/+45/-45 and
 * composites the 12 frames into one contact sheet, so a wide perspective
 * picture masquerading as a panorama is visible rather than inferred.
 *
 *   bun scripts/pano-gate.ts http://localhost:5175 out.jpg
 */
import { chromium } from 'playwright';
import sharp from 'sharp';

const url = process.argv[2] ?? 'http://localhost:5173';
const output = process.argv[3] ?? 'pano-gate.jpg';

const YAWS = [0, 90, 180, 270];
const PITCHES = [45, 0, -45];
const SHOT = { width: 480, height: 320 };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: SHOT });

const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean((window as never as { psv?: unknown }).psv), null, {
  timeout: 30_000,
});
// The texture loads after the viewer object exists.
await page.waitForFunction(
  () => (window as never as { psv: { getPlugin: unknown; state?: { ready?: boolean } } }).psv
    .state?.ready === true,
  null,
  { timeout: 30_000 },
).catch(() => undefined);
await page.waitForTimeout(2500);

const tiles: { input: Buffer; top: number; left: number }[] = [];

for (let row = 0; row < PITCHES.length; row++) {
  for (let col = 0; col < YAWS.length; col++) {
    const yaw = YAWS[col];
    const pitch = PITCHES[row];
    await page.evaluate(
      ([y, p]) =>
        (
          window as never as { psv: { rotate: (pos: { yaw: string; pitch: string }) => void } }
        ).psv.rotate({ yaw: `${y}deg`, pitch: `${p}deg` }),
      [yaw, pitch],
    );
    await page.waitForTimeout(700);
    tiles.push({
      input: await page.screenshot({ type: 'png' }),
      top: row * SHOT.height,
      left: col * SHOT.width,
    });
  }
}

await browser.close();

await sharp({
  create: {
    width: SHOT.width * YAWS.length,
    height: SHOT.height * PITCHES.length,
    channels: 3,
    background: '#000000',
  },
})
  .composite(tiles)
  .jpeg({ quality: 88 })
  .toFile(output);

console.log(`${output}  columns: yaw ${YAWS.join('/')}  rows: pitch ${PITCHES.join('/')}`);
if (errors.length) {
  console.log(`\npage errors (${errors.length}):`);
  for (const e of new Set(errors)) console.log(`  ${e}`);
}
