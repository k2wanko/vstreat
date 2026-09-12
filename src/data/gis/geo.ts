/**
 * Plane geometry for the town GIS.
 *
 * Coordinates are metres on a local tangent plane: +x east, +y north, origin at
 * each town's own datum. The towns are a few hundred metres across, so a flat
 * plane is exact enough and avoids dragging a projection library in for it.
 *
 * Compass bearings are degrees clockwise from north, the convention every map
 * uses. Panorama yaw is radians from the centre of the image, which is what
 * PhotoSphereViewer wants. `yawFor` is the bridge between the two.
 */

export type Point = { e: number; n: number };

/** Compass bearing from `a` to `b`, in degrees clockwise from north. */
export function bearing(a: Point, b: Point): number {
  return norm360((Math.atan2(b.e - a.e, b.n - a.n) * 180) / Math.PI);
}

/** Straight-line distance in metres. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(b.e - a.e, b.n - a.n);
}

export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed difference a - b, wrapped to (-180, 180]. */
export function deltaDeg(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/**
 * Yaw for looking from `at` towards `to`, given which compass bearing the
 * centre of that node's panorama faces.
 *
 * This is the whole point of the GIS: an arrow's direction follows from where
 * the two places actually are, instead of being read off the image by eye.
 */
export function yawFor(at: Point, heading: number, to: Point): number {
  return (deltaDeg(bearing(at, to), heading) * Math.PI) / 180;
}

/** Where a fraction-of-image-width reading implies the panorama is facing. */
export function headingFromObserved(at: Point, to: Point, atFraction: number): number {
  return norm360(bearing(at, to) - (atFraction - 0.5) * 360);
}

/**
 * Best single heading for a node, given several observed exits.
 *
 * Averaged as unit vectors rather than as numbers, because headings wrap: the
 * mean of 350° and 10° is 0°, not 180°.
 */
export function fitHeading(observations: { bearing: number; yawDeg: number }[]): number {
  let x = 0;
  let y = 0;
  for (const o of observations) {
    const h = ((o.bearing - o.yawDeg) * Math.PI) / 180;
    x += Math.cos(h);
    y += Math.sin(h);
  }
  return norm360((Math.atan2(y, x) * 180) / Math.PI);
}
