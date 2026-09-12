#!/usr/bin/env bun
import sharp from 'sharp';
import { loadSurvey, manifestOf, paths } from './lib/worlds.ts';
import { lightInView } from './sun.ts';

const [, , worldId, nodeId] = process.argv;
if (!worldId || !nodeId) {
  console.error('usage: bun scripts/sun-check.ts <worldId> <node>');
  process.exit(2);
}
const survey = loadSurvey(worldId)[nodeId];
if (!survey) {
  console.error(`${worldId} has no station "${nodeId}" (have: ${Object.keys(loadSurvey(worldId)).join(', ')})`);
  process.exit(2);
}
// The panorama is wherever the pipeline just put it, so there is one less
// path for a caller to get wrong.
const file = `${paths(worldId).panoramas}/${nodeId}.png`;

// The peak, not a percentile of the sky. Averaging the brightest 0.3% of the
// sky band put the answer 34 degrees off a sun that was two degrees out: the
// haze around a painted sun is wide and bright, so the centroid slides off the
// disc into it. Blurring first is what keeps a single hot pixel from winning.
const W = 720;
const H = 360;
const { data } = await sharp(file).resize(W, H, { fit: 'fill' }).greyscale().blur(3).raw().toBuffer({ resolveWithObject: true });

const skyRows = { from: 8, to: 160 };
let peak = { v: -1, x: 0, y: 0 };
for (let y = skyRows.from; y < skyRows.to; y++) {
  for (let x = 0; x < W; x++) {
    const v = data[y * W + x];
    if (v > peak.v) peak = { v, x, y };
  }
}
const expected = lightInView(manifestOf(worldId).light, survey.heading);
const expectedX = ((expected.x % 1) + 1) % 1;
const foundX = peak.x / W;
const foundElDeg = 90 - (peak.y / H) * 180;
let errDeg = (foundX - expectedX) * 360;
while (errDeg > 180) errDeg -= 360;
while (errDeg < -180) errDeg += 360;
console.log(`${nodeId}: brightest sky at x=${foundX.toFixed(2)} (${foundElDeg.toFixed(0)} deg up), expected ${expected.body} at x=${expectedX.toFixed(2)} (${expected.elDeg} deg up)`);
console.log(`azimuth error ${errDeg.toFixed(0)} deg  ${Math.abs(errDeg) <= 25 ? 'ok' : 'off'}`);
// A sky band that is mostly wall has no sun in it to find, and this check
// cannot tell you so: in a lane or a covered street, trust the contact sheet.
if (peak.v < 200) console.log(`note: the brightest sky is only ${peak.v}/255 - the sun may not be in frame at all here`);
