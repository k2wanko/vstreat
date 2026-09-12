#!/usr/bin/env bun
import sharp from 'sharp';

/**
 * A deterministic stand-in for a painted panorama: a sky-to-ground gradient
 * that wraps at the seam, with a bright disc where a sun would be. It exists
 * so the pipeline can be run end to end for nothing.
 */
const out = process.argv[2];
if (!out) {
  console.error('usage: mock-image.ts <out.png>');
  process.exit(2);
}
const W = 1536;
const H = 768;
const buf = Buffer.alloc(W * H * 3);
const sun = { x: 0.25 * W, y: 0.28 * H, r: 0.05 * H };
for (let y = 0; y < H; y++) {
  const t = y / H;
  const sky = t < 0.5;
  for (let x = 0; x < W; x++) {
    // One full cosine across the width, so the left and right edges join.
    const band = 12 * Math.cos((x / W) * 2 * Math.PI);
    let r = sky ? 120 + 110 * (1 - t * 2) + band : 96 - 40 * (t - 0.5) * 2 + band;
    let g = sky ? 150 + 80 * (1 - t * 2) + band : 104 - 36 * (t - 0.5) * 2 + band;
    let b = sky ? 200 + 40 * (1 - t * 2) + band : 84 - 28 * (t - 0.5) * 2 + band;
    const dx = Math.min(Math.abs(x - sun.x), W - Math.abs(x - sun.x));
    if (Math.hypot(dx, y - sun.y) < sun.r) { r = 255; g = 250; b = 226; }
    const k = (y * W + x) * 3;
    buf[k] = Math.max(0, Math.min(255, r));
    buf[k + 1] = Math.max(0, Math.min(255, g));
    buf[k + 2] = Math.max(0, Math.min(255, b));
  }
}
await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(out);
console.log(`mock ${W}x${H} -> ${out}`);
