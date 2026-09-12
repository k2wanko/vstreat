import { describe, expect, it } from 'vitest';
import {
  analyseSeam,
  centredEquirectCrop,
  CONTROL_FLOOR,
  partialPanoData,
  RATIO_LIMIT,
} from './pano.ts';

/** Build a single-channel image from a function of (x, y). */
function image(width: number, height: number, at: (x: number, y: number) => number): number[] {
  const data: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.push(at(x, y));
  }
  return data;
}

describe('analyseSeam', () => {
  it('screens in an image whose edges join as smoothly as its interior', () => {
    // A horizontal sine that completes whole cycles across the width, so the
    // wrap from the last column back to the first is just another step.
    const width = 64;
    const data = image(width, 16, (x) => 128 + 100 * Math.sin((2 * Math.PI * x) / width));

    const m = analyseSeam(data, width, 16, 1);

    expect(m.verdict).toBe('screened-in');
    expect(m.ratio).toBeLessThan(RATIO_LIMIT);
  });

  it('fails an image with a hard discontinuity at the wrap', () => {
    // A gentle ramp 0..63 — every interior step is 1, but the wrap step is 63.
    const width = 64;
    const data = image(width, 16, (x) => x);

    const m = analyseSeam(data, width, 16, 1);

    expect(m.seam).toBeCloseTo(width - 1, 5);
    expect(m.control).toBeCloseTo(1, 5);
    expect(m.verdict).toBe('fail-ratio');
  });

  it('refuses to judge a flat image instead of scoring it well', () => {
    // Both seam and control are 0. Without the floor this would look perfect.
    const data = image(32, 8, () => 200);

    const m = analyseSeam(data, 32, 8, 1);

    expect(m.seam).toBe(0);
    expect(m.control).toBeLessThan(CONTROL_FLOOR);
    expect(m.verdict).toBe('fail-uniform');
  });

  it('averages across channels', () => {
    // RGB, 2x1: left pixel (0,0,0), right pixel (30,60,90).
    const data = [0, 0, 0, 30, 60, 90];

    const m = analyseSeam(data, 2, 1, 3);

    expect(m.seam).toBeCloseTo(60, 5); // (30+60+90)/3
    expect(m.control).toBeCloseTo(60, 5);
  });

  it('rejects an image too small to have a seam', () => {
    expect(() => analyseSeam([1], 1, 1, 1)).toThrow(/too small/);
  });
});

describe('partialPanoData', () => {
  it('centres a 120 degree arc inside a 2:1 sphere', () => {
    const d = partialPanoData(1672, 941, 120);

    expect(d.fullWidth).toBe(5016); // 1672 * 360/120
    expect(d.fullHeight).toBe(2508); // always half the width
    expect(d.croppedWidth).toBe(1672);
    expect(d.croppedHeight).toBe(941);
    expect(d.croppedX).toBe(1672); // (5016 - 1672) / 2
    expect(d.croppedY).toBe(784); // (2508 - 941) / 2
  });

  it('keeps the full panorama at a 2:1 ratio for any hfov', () => {
    for (const hfov of [60, 90, 120, 180, 360]) {
      const d = partialPanoData(1672, 836, hfov);
      expect(d.fullWidth / d.fullHeight).toBeCloseTo(2, 5);
    }
  });

  it('leaves no offset when the arc is the whole sphere', () => {
    const d = partialPanoData(1672, 836, 360);

    expect(d.fullWidth).toBe(1672);
    expect(d.croppedX).toBe(0);
    expect(d.croppedY).toBe(0);
  });

  it('rejects an hfov so wide the image cannot fit the sphere', () => {
    // 1672x941 at 360 deg would need a 836px-tall sphere.
    expect(() => partialPanoData(1672, 941, 360)).toThrow(/taller/);
  });

  it('rejects an out-of-range hfov', () => {
    expect(() => partialPanoData(1672, 941, 0)).toThrow(/hfov/);
    expect(() => partialPanoData(1672, 941, 361)).toThrow(/hfov/);
  });
});

describe('centredEquirectCrop', () => {
  it('crops the common 16:9 output to 2:1 by trimming top and bottom', () => {
    const c = centredEquirectCrop(1672, 941);

    expect(c.width).toBe(1672);
    expect(c.height).toBe(836);
    expect(c.left).toBe(0);
    expect(c.top).toBe(52); // (941 - 836) / 2
  });

  it('is a no-op on an image that is already 2:1', () => {
    expect(centredEquirectCrop(1672, 836)).toEqual({ left: 0, top: 0, width: 1672, height: 836 });
  });

  it('trims the sides when the image is taller than 2:1', () => {
    const c = centredEquirectCrop(1000, 1000);

    expect(c.width).toBe(1000);
    expect(c.height).toBe(500);
    expect(c.top).toBe(250);
  });
});
