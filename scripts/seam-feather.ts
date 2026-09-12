#!/usr/bin/env bun
import sharp from 'sharp';

const [, , input, output, bandArg] = process.argv;
if (!input || !output) {
  console.error('usage: bun scripts/seam-feather.ts <in.png> <out.png> [band-px]');
  process.exit(2);
}
const band = Number(bandArg ?? 48);
const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels } = info;
const out = Buffer.from(data);
const at = (x: number, y: number, c: number) => data[(y * W + x) * channels + c];
for (let y = 0; y < H; y++) {
  for (let k = 0; k < band; k++) {
    const towardSeam = (k + 0.5) / band;
    const xr = W - band + k;
    const xl = band - 1 - k;
    const w = towardSeam / 2;
    const ir = (y * W + xr) * channels;
    const il = (y * W + xl) * channels;
    for (let c = 0; c < channels; c++) {
      out[ir + c] = Math.round(at(xr, y, c) * (1 - w) + at(xl, y, c) * w);
      out[il + c] = Math.round(at(xl, y, c) * (1 - w) + at(xr, y, c) * w);
    }
  }
}
await sharp(out, { raw: { width: W, height: H, channels } }).png().toFile(output);
console.log(`${output}  feathered ${band}px each side of the wrap`);
