import { describe, expect, it } from 'vitest';
import { parseViewState, sameLink, toSearch, type ViewState, wrap360 } from './url-state.ts';

const view: ViewState = { world: 'sometown', node: 'a-corner', yaw: 53.5, pitch: -2.1, zoom: 30 };

describe('toSearch', () => {
  it('writes every part of the view', () => {
    expect(toSearch(view)).toBe('?w=sometown&n=a-corner&y=53.5&p=-2.1&z=30');
  });

  it('wraps yaw into a single turn so links do not accumulate revolutions', () => {
    expect(toSearch({ ...view, yaw: 413.5 })).toContain('y=53.5');
    expect(toSearch({ ...view, yaw: -10 })).toContain('y=350');
  });

  it('clamps pitch and zoom to what the viewer can actually show', () => {
    const s = toSearch({ ...view, pitch: -140, zoom: 999 });
    expect(s).toContain('p=-90');
    expect(s).toContain('z=100');
  });

  it('rounds angles, so nudging the view does not rewrite the link every frame', () => {
    expect(toSearch({ ...view, yaw: 53.54321 })).toContain('y=53.5');
  });
});

describe('parseViewState', () => {
  it('round-trips a link it wrote', () => {
    expect(parseViewState(toSearch(view))).toEqual(view);
  });

  it('accepts a link with only a place', () => {
    expect(parseViewState('?w=sometown&n=a-corner')).toEqual({ world: 'sometown', node: 'a-corner' });
  });

  it('returns nothing for an empty query', () => {
    expect(parseViewState('')).toEqual({});
  });

  it('ignores values that are not numbers rather than failing to open', () => {
    // A truncated or hand-mangled link should still take you to the place.
    expect(parseViewState('?w=sometown&n=a-corner&y=abc&p=&z=NaN')).toEqual({
      world: 'sometown',
      node: 'a-corner',
    });
  });

  it('normalises angles that arrive out of range', () => {
    expect(parseViewState('?y=-90')).toEqual({ yaw: 270 });
    expect(parseViewState('?p=120')).toEqual({ pitch: 90 });
    expect(parseViewState('?z=-5')).toEqual({ zoom: 0 });
  });

  it('keeps a yaw of zero rather than treating it as missing', () => {
    expect(parseViewState('?y=0')).toEqual({ yaw: 0 });
  });
});

describe('sameLink', () => {
  it('is false when there is nothing to compare against', () => {
    expect(sameLink(null, view)).toBe(false);
  });

  it('ignores differences too small to appear in the link', () => {
    expect(sameLink(view, { ...view, yaw: 53.51 })).toBe(true);
  });

  it('notices a real move', () => {
    expect(sameLink(view, { ...view, node: 'riverbank' })).toBe(false);
    expect(sameLink(view, { ...view, yaw: 90 })).toBe(false);
  });
});

describe('wrap360', () => {
  it('maps any angle into one turn', () => {
    expect(wrap360(0)).toBe(0);
    expect(wrap360(360)).toBe(0);
    expect(wrap360(-1)).toBe(359);
    expect(wrap360(720 + 45)).toBe(45);
  });
});
