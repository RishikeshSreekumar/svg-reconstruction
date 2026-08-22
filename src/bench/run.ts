import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenSVG } from './flatten.ts';
import { compare, type CompareResult } from './compare.ts';
import { reconstructSVG } from '../reconstruct.ts';
import { sceneToSVG, sceneToText } from '../emit/to-svg.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const fixturesDir = join(root, 'fixtures');
const outDir = join(root, '.bench-out');

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const padL = (s: string, n: number): string => (s.length >= n ? s : ' '.repeat(n - s.length) + s);
const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;

function main(): void {
  const only = process.argv[2];
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.svg'))
    .filter((f) => !only || f.includes(only))
    .sort();

  // Two passes. The coarse pass mimics exporters that round to one decimal —
  // real path soup is quantized, and a fitter tuned on clean numbers lies.
  const PASSES = [
    { label: 'p2', precision: 2 },
    { label: 'p1', precision: 1 },
  ];

  const rows: { name: string; byPass: Record<string, CompareResult>; note: string }[] = [];

  for (const file of files) {
    const name = basename(file, '.svg');
    const original = readFileSync(join(fixturesDir, file), 'utf8');
    const byPass: Record<string, CompareResult> = {};
    let note = '';

    for (const p of PASSES) {
      // Forward model: destroy the construction, exactly as an exporter would.
      const flat = flattenSVG(original, { precision: p.precision });
      const scene = reconstructSVG(flat);
      const out = sceneToSVG(scene, { annotate: true });
      byPass[p.label] = compare(original, flat, scene, out);

      if (p.label === 'p2') {
        writeFileSync(join(outDir, `${name}.flat.svg`), flat);
        writeFileSync(join(outDir, `${name}.out.svg`), out);
        writeFileSync(join(outDir, `${name}.txt`), sceneToText(scene));
        note = scene.report.notes[0] ?? '';
      }
    }
    rows.push({ name, byPass, note });
  }

  console.log(
    pad('fixture', 24) +
      padL('relHaus', 9) +
      padL('F1', 6) +
      padL('F1@p1', 7) +
      padL('coords', 13) +
      '  note',
  );
  console.log('-'.repeat(96));

  const sums: Record<string, { f1: number; h: number }> = {};
  for (const p of PASSES) sums[p.label] = { f1: 0, h: 0 };

  for (const { name, byPass, note } of rows) {
    for (const p of PASSES) {
      sums[p.label].f1 += byPass[p.label].f1;
      sums[p.label].h += byPass[p.label].relHausdorff;
    }
    const r = byPass['p2'];
    const shrink = r.coordsIn > 0 ? `${r.coordsIn}->${r.coordsOut}` : '-';
    console.log(
      pad(name, 24) +
        padL(r.relHausdorff.toExponential(1), 9) +
        padL(pct(r.f1), 6) +
        padL(pct(byPass['p1'].f1), 7) +
        padL(shrink, 13) +
        '  ' +
        note.slice(0, 38),
    );
  }
  console.log('-'.repeat(96));
  const n = rows.length || 1;
  console.log(
    `${pad('MEAN', 24)}${padL((sums['p2'].h / n).toExponential(1), 9)}${padL(pct(sums['p2'].f1 / n), 6)}${padL(pct(sums['p1'].f1 / n), 7)}`,
  );
  console.log(`\nartifacts in ${outDir}`);
}

main();
