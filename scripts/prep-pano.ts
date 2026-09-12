#!/usr/bin/env bun
/**
 * Turn a raw generated image into a panorama the viewer can load:
 * centre-crop to an exact 2:1 sphere and encode as JPEG.
 *
 * PNG at this size is ~3 MB each; JPEG q85 is ~250 KB, which matters when the
 * tour ships eight of them.
 *
 *   bun scripts/prep-pano.ts raw/plaza.png public/panoramas/plaza.jpg
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { centredEquirectCrop } from '../src/lib/pano.ts';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: bun scripts/prep-pano.ts <input> <output.jpg>');
  process.exit(2);
}

const image = sharp(input);
const { width, height } = await image.metadata();
if (!width || !height) throw new Error(`cannot read dimensions of ${input}`);

const crop = centredEquirectCrop(width, height);
await mkdir(dirname(output), { recursive: true });
await image.extract(crop).jpeg({ quality: 85, mozjpeg: true }).toFile(output);

const noop = crop.width === width && crop.height === height;
console.log(
  `${input} ${width}x${height} -> ${output} ${crop.width}x${crop.height}` +
    (noop ? ' (already 2:1, no crop)' : ` (cropped at ${crop.left},${crop.top})`),
);
