import type { Field } from '../../../src/index.ts';
import type { PField } from '../components/ParamRow.svelte';

/** A parameter row: one caption over one or two boxes. */
export interface ParamRowSpec {
  label: string;
  fields: PField[];
}

/**
 * Coordinates come in pairs, so the inspector shows them in pairs. Anything
 * listed here collapses two fields into one row captioned by what the pair
 * means — "Center", "Size" — instead of two rows named after `d`-attribute
 * letters. The first key of a pair is the one that anchors the row's position
 * in the list.
 */
const PAIRS: [string, string][] = [
  ['x', 'y'],
  ['w', 'h'],
  ['rx', 'ry'],
  ['c.x', 'c.y'],
  ['a.x', 'a.y'],
  ['b.x', 'b.y'],
  ['p.x', 'p.y'],
  ['cx', 'cy'],
  ['x1', 'y1'],
  ['x2', 'y2'],
];

const PAIR_LABELS: Record<string, string> = {
  'x|y': 'Position',
  'w|h': 'Size',
  'rx|ry': 'Radii',
  'c.x|c.y': 'Center',
  'a.x|a.y': 'Start point',
  'b.x|b.y': 'End point',
  'p.x|p.y': 'Position',
  'cx|cy': 'Center',
  'x1|y1': 'Start point',
  'x2|y2': 'End point',
};

const SINGLE_LABELS: Record<string, string> = {
  r: 'Radius',
  rx: 'Horizontal radius',
  ry: 'Vertical radius',
  rot: 'Rotation',
  sides: 'Sides',
  fontSize: 'Font size',
  'style.strokeWidth': 'Outline width',
  sweep: 'Sweep',
  len: 'Length',
  angle: 'Angle',
  x: 'Left X',
  y: 'Top Y',
};

/** A rectangle's `x`/`y` is a corner, not a centre, and its `rx` is a fillet. */
const RECT_LABELS: Record<string, string> = {
  'x|y': 'Top left',
  rx: 'Corner radius',
};

/** The glyph that rides inside a paired box, naming which half it is. */
const AXES: Record<string, string> = { x: 'X', y: 'Y', w: 'W', h: 'H' };

/** `x1`, `c.x`, `cx` and `x` are all the x of something — strip the ordinal. */
const axisOf = (key: string): string | undefined => AXES[key.replace(/\d+$/, '').slice(-1)];

function toPField(f: Field, axis: boolean): PField {
  return { key: f.key, value: f.value, axis: axis ? axisOf(f.key) : undefined, unit: f.deg ? '°' : undefined };
}

/**
 * Group a flat field list into inspector rows. `kind` only shifts wording —
 * every field is still present exactly once, in source order.
 */
export function paramRows(fields: Field[], kind?: string): ParamRowSpec[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const taken = new Set<string>();
  const rows: ParamRowSpec[] = [];
  const rect = kind === 'rect';

  for (const f of fields) {
    if (taken.has(f.key)) continue;
    const pair = PAIRS.find((p) => p[0] === f.key && byKey.has(p[1]) && !taken.has(p[1]));
    if (pair) {
      const other = byKey.get(pair[1])!;
      taken.add(pair[0]);
      taken.add(pair[1]);
      const id = `${pair[0]}|${pair[1]}`;
      rows.push({ label: (rect && RECT_LABELS[id]) || PAIR_LABELS[id] || f.label, fields: [toPField(f, true), toPField(other, true)] });
    } else {
      taken.add(f.key);
      rows.push({ label: (rect && RECT_LABELS[f.key]) || SINGLE_LABELS[f.key] || f.label, fields: [toPField(f, false)] });
    }
  }
  return rows;
}
