/**
 * Panorama geometry helpers.
 *
 * `analyseSeam` is only a cheap screen: it measures whether the left and right
 * edges are continuous, which is necessary but NOT sufficient for the image to
 * be a true equirectangular projection. A wide perspective render with sky at
 * the top and ground at the bottom can pass it. The deciding check is the
 * multi-angle visual inspection described in the plan.
 */

export type PanoData = {
  fullWidth: number;
  fullHeight: number;
  croppedWidth: number;
  croppedHeight: number;
  croppedX: number;
  croppedY: number;
};

export type SeamVerdict = 'screened-in' | 'fail-ratio' | 'fail-uniform';

export type SeamMetrics = {
  width: number;
  height: number;
  /** mean |pixel| difference across the wrap boundary (column W-1 vs column 0) */
  seam: number;
  /** mean |pixel| difference between horizontally adjacent interior columns */
  control: number;
  /** seam / control — self-calibrating against how busy the image is */
  ratio: number;
  verdict: SeamVerdict;
};

/** Above this, the edges clearly do not join. */
export const RATIO_LIMIT = 3;
/**
 * Below this the interior is so flat (blank sky, plain wall) that `ratio`
 * carries no information — `seam` would trend to 0 for the wrong reason.
 */
export const CONTROL_FLOOR = 2;

function meanAbsDiff(
  data: ArrayLike<number>,
  aOffset: number,
  bOffset: number,
  channels: number,
): number {
  let sum = 0;
  for (let c = 0; c < channels; c++) {
    sum += Math.abs(data[aOffset + c] - data[bOffset + c]);
  }
  return sum / channels;
}

/**
 * @param data raw interleaved pixels, row-major, 8 bits per channel
 * @param stride how many interior column pairs to skip between samples
 */
export function analyseSeam(
  data: ArrayLike<number>,
  width: number,
  height: number,
  channels: number,
  stride = 1,
): SeamMetrics {
  if (width < 2 || height < 1) {
    throw new Error(`image too small to analyse: ${width}x${height}`);
  }

  const rowBytes = width * channels;
  let seamSum = 0;
  let controlSum = 0;
  let controlCount = 0;

  for (let y = 0; y < height; y++) {
    const row = y * rowBytes;
    seamSum += meanAbsDiff(data, row + (width - 1) * channels, row, channels);

    for (let x = 0; x + 1 < width; x += stride) {
      controlSum += meanAbsDiff(data, row + x * channels, row + (x + 1) * channels, channels);
      controlCount++;
    }
  }

  const seam = seamSum / height;
  const control = controlCount > 0 ? controlSum / controlCount : 0;
  // Clamping the denominator keeps the ratio meaningful when the interior is
  // flat: a hard edge step still scores high (rather than dividing by ~0 and
  // blowing up), while a flat image with no step scores ~0 and is then caught
  // by the uniform guard below.
  const ratio = seam / Math.max(control, CONTROL_FLOOR);

  // Order matters. A large ratio means the edges genuinely do not join, however
  // flat the interior is, so it is decisive. The uniform guard is only for the
  // opposite case — seam and control both near zero, e.g. blank sky at each
  // edge — which would otherwise read as a clean wrap while telling us nothing.
  let verdict: SeamVerdict;
  if (ratio >= RATIO_LIMIT) {
    verdict = 'fail-ratio';
  } else if (control < CONTROL_FLOOR) {
    verdict = 'fail-uniform';
  } else {
    verdict = 'screened-in';
  }

  return { width, height, seam, control, ratio, verdict };
}

/**
 * Branch B: describe a limited-arc image as a cropped region of a full sphere,
 * centred both horizontally and vertically. PhotoSphereViewer needs the full
 * panorama to stay 2:1.
 *
 * Note this only tells the viewer where the pixels belong — it does NOT stop
 * the user panning into the empty region. That requires VisibleRangePlugin
 * with `usePanoData: true` (its default is false).
 */
export function partialPanoData(width: number, height: number, hfovDeg: number): PanoData {
  if (hfovDeg <= 0 || hfovDeg > 360) {
    throw new Error(`hfov must be within (0, 360]: ${hfovDeg}`);
  }

  const fullWidth = Math.round((width * 360) / hfovDeg);
  const fullHeight = Math.round(fullWidth / 2);

  if (height > fullHeight) {
    throw new Error(
      `image is taller (${height}) than the sphere it would sit in (${fullHeight}); hfov ${hfovDeg} is too wide`,
    );
  }

  return {
    fullWidth,
    fullHeight,
    croppedWidth: width,
    croppedHeight: height,
    croppedX: Math.round((fullWidth - width) / 2),
    croppedY: Math.round((fullHeight - height) / 2),
  };
}

/**
 * Branch A: the largest centred 2:1 box that fits inside the source image.
 * For the common 1672x941 output this crops to 1672x836 — about 12% of vertical
 * coverage is discarded near the poles, which the plan accepts.
 */
export function centredEquirectCrop(
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const targetHeight = Math.min(height, Math.floor(width / 2));
  const targetWidth = targetHeight * 2;
  return {
    left: Math.floor((width - targetWidth) / 2),
    top: Math.floor((height - targetHeight) / 2),
    width: targetWidth,
    height: targetHeight,
  };
}
