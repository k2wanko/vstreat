#!/usr/bin/env bun
/**
 * Record one pass of a town's exhibit loop to a WebM.
 *
 *   bun run preview &
 *   bun scripts/record-loop.ts 'http://localhost:4173/?w=dragon&loop=1' loop.webm
 *
 * Convert with ffmpeg when ready:
 *   ffmpeg -y -i loop.webm -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart loop.mp4
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/?loop=1';
const out = process.argv[3] ?? 'loop.webm';
// One full script pass is ~80–100 s; pad so we do not cut the bridge short.
const durationMs = Number(process.argv[4] ?? 110_000);

await mkdir(dirname(out), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: dirname(out), size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();
console.log(`opening ${url}`);
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean((window as never as { psv?: unknown }).psv), null, {
  timeout: 30_000,
});
console.log(`recording ${durationMs}ms...`);
await page.waitForTimeout(durationMs);
const video = page.video();
await context.close();
await browser.close();
if (!video) throw new Error('no video captured');
const recorded = await video.path();
await Bun.write(out, Bun.file(recorded));
console.log(`wrote ${out} (from ${recorded})`);
