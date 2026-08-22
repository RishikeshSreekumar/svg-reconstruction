#!/usr/bin/env -S npx tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { reconstructSVG } from '../src/reconstruct.ts';
import { sceneToSVG, sceneToText } from '../src/emit/to-svg.ts';
import { flattenSVG } from '../src/bench/flatten.ts';

const HELP = `svgrec — recover primitives, strokes and constraints from flattened SVG

  svgrec <input.svg> [-o out.svg] [options]

  -o, --out <file>     write reconstructed SVG (default: stdout)
  -j, --json <file>    write the scene graph as JSON
  -t, --text           print the construction listing to stderr
      --tol <n>        deviation tolerance as a fraction of the diagonal (default 0.0015)
      --no-strokes     skip stroke recovery
      --no-constraints skip constraint detection and snapping
      --annotate       emit data-confidence / data-from attributes
      --flatten        run the FORWARD model instead: editable SVG -> path soup
`;

function main(): void {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(HELP);
    process.exit(argv.length ? 0 : 1);
  }

  // Flags that consume the following token. Anything else that is not a flag
  // is the input file.
  const VALUED = new Set(['-o', '--out', '-j', '--json', '--tol']);
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-')) {
      positional.push(a);
    } else if (VALUED.has(a)) {
      values.set(a, argv[++i] ?? '');
    } else {
      flags.add(a);
    }
  }

  const flag = (...names: string[]): boolean => names.some((n) => flags.has(n));
  const val = (...names: string[]): string | undefined => {
    for (const n of names) {
      const v = values.get(n);
      if (v != null) return v;
    }
    return undefined;
  };

  const input = positional[0];
  if (!input) {
    process.stderr.write('no input file\n');
    process.exit(1);
  }
  const src = readFileSync(input, 'utf8');

  if (flag('--flatten')) {
    const flat = flattenSVG(src);
    const out = val('-o', '--out');
    if (out) writeFileSync(out, flat);
    else process.stdout.write(flat);
    return;
  }

  const tol = val('--tol');
  const scene = reconstructSVG(src, {
    relTol: tol ? Number(tol) : undefined,
    detectStrokes: !flag('--no-strokes'),
    detectConstraints: !flag('--no-constraints'),
  });

  const svg = sceneToSVG(scene, { annotate: flag('--annotate') });
  const outPath = val('-o', '--out');
  if (outPath) writeFileSync(outPath, svg);
  else process.stdout.write(svg);

  const jsonPath = val('-j', '--json');
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(scene, null, 2));

  if (flag('-t', '--text') || outPath) process.stderr.write(sceneToText(scene) + '\n');
}

main();
