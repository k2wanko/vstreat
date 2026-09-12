#!/usr/bin/env bun
/**
 * Step 1 gate, part (a): the cheap screen.
 *
 * Reports the seam/control ratio for a candidate panorama. A "screened-in"
 * verdict does NOT mean the image is a 360 panorama — it only means it is not
 * obviously a flat picture. Decide with the multi-angle visual check.
 *
 *   bun scripts/pano-check.ts raw/plaza.png
 */
import sharp from 'sharp';
import { analyseSeam, centredEquirectCrop, partialPanoData } from '../src/lib/pano.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: bun scripts/pano-check.ts <image>');
  process.exit(2);
}

const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const metrics = analyseSeam(data, info.width, info.height, info.channels);

console.log(`file      ${file}`);
console.log(`size      ${metrics.width}x${metrics.height} (${(metrics.width / metrics.height).toFixed(3)}:1)`);
console.log(`seam      ${metrics.seam.toFixed(3)}`);
console.log(`control   ${metrics.control.toFixed(3)}`);
console.log(`ratio     ${metrics.ratio.toFixed(3)}`);
console.log(`verdict   ${metrics.verdict}`);
console.log('');

if (metrics.verdict === 'screened-in') {
  const crop = centredEquirectCrop(metrics.width, metrics.height);
  console.log('Screen passed. Branch A crop would be:');
  console.log(`  ${crop.width}x${crop.height} at (${crop.left}, ${crop.top})`);
  console.log('');
  console.log('NOT A PASS YET. Render it and check yaw 0/90/180/270 x pitch 0/+45/-45:');
  console.log('  - four directions show genuinely different parts of the scene');
  console.log('  - no seam step in vertical structures at yaw 180');
  console.log('  - vertical lines stay vertical out to the left/right edges');
  console.log('  - no extreme smearing or missing black at pitch +/-45');
} else {
  const reason =
    metrics.verdict === 'fail-uniform'
      ? `interior too flat (control ${metrics.control.toFixed(3)} < floor); ratio is meaningless`
      : `edges do not join (ratio ${metrics.ratio.toFixed(3)} >= limit)`;
  console.log(`Screen failed: ${reason}`);
  console.log('Use Branch B. panoData at 120 deg hfov:');
  console.log(`  ${JSON.stringify(partialPanoData(metrics.width, metrics.height, 120))}`);
  console.log('  Remember VisibleRangePlugin.withConfig({ usePanoData: true }).');
}
