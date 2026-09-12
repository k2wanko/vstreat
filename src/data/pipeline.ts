import type { Pipeline, TourNode } from './world.ts';

export const STAGES = [
  { id: 'aerial', label: '\u2460 \u7a7a\u64ae', hint: '\u753b\u50cf\u30e2\u30c7\u30eb\u304c\u63cf\u3044\u305f\u822a\u7a7a\u5199\u771f\u3002\u3053\u3053\u304b\u3089\u5168\u90e8\u304c\u59cb\u307e\u308b' },
  { id: 'gis', label: '\u2461 GIS \u62bd\u51fa', hint: '\u5199\u771f\u304b\u3089\u9053\u8def\u30fb\u5efa\u7269\u30fb\u7802\u6d5c\u30fb\u68ee\u30fb\u6d77\u3092\u30d9\u30af\u30bf\u3067\u62bd\u51fa' },
  { id: 'massing', label: '\u2462 3D \u914d\u7f6e', hint: '\u9ad8\u3055\u5834\u306b\u62bc\u3057\u51fa\u3057\u305f 3D\u3002\u5730\u70b9\u304b\u3089 360\u00b0 \u3067\u63cf\u753b\u3057\u3066\u753b\u50cf\u30e2\u30c7\u30eb\u306b\u6e21\u3059' },
  { id: 'street', label: '\u2463 \u30b9\u30c8\u30ea\u30fc\u30c8\u30d3\u30e5\u30fc', hint: '3D \u3092\u4e0b\u6577\u304d\u306b \u753b\u50cf\u30e2\u30c7\u30eb\u304c\u63cf\u3044\u305f 360\u00b0\u3002\u5730\u56f3\u3068\u306e\u305a\u308c\u306f\u69cb\u9020\u4e0a\u8d77\u304d\u306a\u3044' },
] as const;

export type StageId = (typeof STAGES)[number]['id'];

export const DEFAULT_STAGE: StageId = 'street';

export function stageMapImage(pipeline: Pipeline, stage: StageId): string {
  if (stage === 'aerial') return pipeline.aerial;
  if (stage === 'gis') return pipeline.overlay;
  return pipeline.massing;
}

export function stagePanorama(pipeline: Pipeline, node: TourNode, stage: StageId): string {
  return stage === 'massing' ? (pipeline.blockouts[node.id] ?? node.panorama) : node.panorama;
}

export function stageShowsMapLarge(stage: StageId): boolean {
  return stage === 'aerial' || stage === 'gis';
}
