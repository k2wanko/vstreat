/**
 * One light for a whole town, declared in its manifest.
 *
 * It is the same in every panorama, which is what stops a town reading as a
 * collage, and it is why changing it after painting has started invalidates
 * every picture already painted.
 */
export type Light = { azDeg: number; elDeg: number; body: string; mood: string };

export function lightInView(light: Light, headingDeg: number) {
  const rel = ((light.azDeg - headingDeg + 540) % 360) - 180;
  const shadowRel = ((light.azDeg + 180 - headingDeg + 540) % 360) - 180;
  return { rel, x: 0.5 + rel / 360, shadowRel, elDeg: light.elDeg, body: light.body };
}

export function describeRel(rel: number): string {
  const a = Math.abs(rel);
  const side = rel >= 0 ? 'right' : 'left';
  if (a < 20) return 'straight ahead';
  if (a < 70) return `ahead and to the ${side}, about ${Math.round(a)} degrees ${side} of centre`;
  if (a < 110) return `directly to the ${side}, about ${Math.round(a)} degrees ${side} of centre`;
  if (a < 160) return `behind and to the ${side}, about ${Math.round(a)} degrees ${side} of centre`;
  return 'directly behind the camera, split across the left and right edges';
}

export function lightBlock(light: Light, headingDeg: number): string {
  const l = lightInView(light, headingDeg);
  const body = l.body.toUpperCase();
  return `${body} — one ${l.body}, the same for every place in this town, ${light.mood}: it stands ${l.elDeg} degrees above the horizon, ${describeRel(l.rel)}, which puts it at about ${Math.round(l.x * 100)}% of the image width from the left edge and well above the horizon line. Every shadow falls ${describeRel(l.shadowRel)}, directly away from the ${l.body}, and the faces that look toward it are the lit ones.`;
}
