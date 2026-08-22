import type { Cmd, Mat, Pt, SubPath } from '../types.ts';
import { apply, isSimilarity, scaleOf } from '../geom/mat.ts';
import { endpointToCenter, flattenArc } from '../geom/arc.ts';
import { flattenCubic, quadToCubic } from '../geom/bezier.ts';

const ARG_COUNT: Record<string, number> = {
  m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0,
};

/** Tokenize a `d` string into absolute commands, resolving S/T/H/V shorthand. */
export function parsePathData(d: string): Cmd[] {
  const out: Cmd[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
  const toks: (string | number)[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) toks.push(m[1] !== undefined ? m[1] : Number(m[2]));

  let i = 0;
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let lastCtrlC: Pt | null = null;
  let lastCtrlQ: Pt | null = null;
  let op = '';

  const num = (): number => {
    const v = toks[i++];
    return typeof v === 'number' ? v : NaN;
  };

  while (i < toks.length) {
    const tok = toks[i];
    if (typeof tok === 'string') {
      op = tok;
      i++;
      if (op === 'Z' || op === 'z') {
        out.push({ t: 'Z' });
        cur = { ...start };
        lastCtrlC = lastCtrlQ = null;
        continue;
      }
    } else if (!op) {
      break; // numbers before any command: malformed
    } else if (op === 'M') {
      op = 'L'; // repeated M args are implicit lineto
    } else if (op === 'm') {
      op = 'l';
    }

    const lower = op.toLowerCase();
    const rel = op !== op.toUpperCase();
    if (toks.length - i < ARG_COUNT[lower]) break;
    const ox = rel ? cur.x : 0;
    const oy = rel ? cur.y : 0;

    switch (lower) {
      case 'm': {
        const p = { x: num() + ox, y: num() + oy };
        out.push({ t: 'M', p });
        cur = p;
        start = { ...p };
        lastCtrlC = lastCtrlQ = null;
        break;
      }
      case 'l': {
        const p = { x: num() + ox, y: num() + oy };
        out.push({ t: 'L', p });
        cur = p;
        lastCtrlC = lastCtrlQ = null;
        break;
      }
      case 'h': {
        const p = { x: num() + ox, y: cur.y };
        out.push({ t: 'L', p });
        cur = p;
        lastCtrlC = lastCtrlQ = null;
        break;
      }
      case 'v': {
        const p = { x: cur.x, y: num() + oy };
        out.push({ t: 'L', p });
        cur = p;
        lastCtrlC = lastCtrlQ = null;
        break;
      }
      case 'c': {
        const c1 = { x: num() + ox, y: num() + oy };
        const c2 = { x: num() + ox, y: num() + oy };
        const p = { x: num() + ox, y: num() + oy };
        out.push({ t: 'C', c1, c2, p });
        lastCtrlC = c2;
        lastCtrlQ = null;
        cur = p;
        break;
      }
      case 's': {
        const c1: Pt = lastCtrlC ? { x: 2 * cur.x - lastCtrlC.x, y: 2 * cur.y - lastCtrlC.y } : { ...cur };
        const c2 = { x: num() + ox, y: num() + oy };
        const p = { x: num() + ox, y: num() + oy };
        out.push({ t: 'C', c1, c2, p });
        lastCtrlC = c2;
        lastCtrlQ = null;
        cur = p;
        break;
      }
      case 'q': {
        const c1 = { x: num() + ox, y: num() + oy };
        const p = { x: num() + ox, y: num() + oy };
        out.push({ t: 'Q', c1, p });
        lastCtrlQ = c1;
        lastCtrlC = null;
        cur = p;
        break;
      }
      case 't': {
        const c1: Pt = lastCtrlQ ? { x: 2 * cur.x - lastCtrlQ.x, y: 2 * cur.y - lastCtrlQ.y } : { ...cur };
        const p = { x: num() + ox, y: num() + oy };
        out.push({ t: 'Q', c1, p });
        lastCtrlQ = c1;
        lastCtrlC = null;
        cur = p;
        break;
      }
      case 'a': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num() !== 0;
        const sweep = num() !== 0;
        const p = { x: num() + ox, y: num() + oy };
        out.push({ t: 'A', rx, ry, rot, large, sweep, p });
        lastCtrlC = lastCtrlQ = null;
        cur = p;
        break;
      }
    }
  }
  return out;
}

/** Apply a matrix to absolute commands. Arcs survive under similarity transforms. */
export function transformCmds(cmds: Cmd[], m: Mat): Cmd[] {
  const sim = isSimilarity(m);
  const s = scaleOf(m);
  const rotDelta = (Math.atan2(m.b, m.a) * 180) / Math.PI;
  const flip = m.a * m.d - m.b * m.c < 0;
  const out: Cmd[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };

  for (const c of cmds) {
    switch (c.t) {
      case 'M':
        out.push({ t: 'M', p: apply(m, c.p) });
        cur = c.p;
        start = c.p;
        break;
      case 'L':
        out.push({ t: 'L', p: apply(m, c.p) });
        cur = c.p;
        break;
      case 'C':
        out.push({ t: 'C', c1: apply(m, c.c1), c2: apply(m, c.c2), p: apply(m, c.p) });
        cur = c.p;
        break;
      case 'Q':
        out.push({ t: 'Q', c1: apply(m, c.c1), p: apply(m, c.p) });
        cur = c.p;
        break;
      case 'A': {
        if (sim) {
          out.push({
            t: 'A',
            rx: c.rx * s,
            ry: c.ry * s,
            rot: c.rot + rotDelta,
            large: c.large,
            sweep: flip ? !c.sweep : c.sweep,
            p: apply(m, c.p),
          });
        } else {
          // Non-similarity: degrade the arc to sampled lines rather than lie.
          const arc = endpointToCenter(cur, c.rx, c.ry, c.rot, c.large, c.sweep, c.p);
          if (arc) {
            const pts: Pt[] = [];
            flattenArc(arc, Math.max(c.rx, c.ry) * 1e-3, pts);
            for (const p of pts) out.push({ t: 'L', p: apply(m, p) });
          } else {
            out.push({ t: 'L', p: apply(m, c.p) });
          }
        }
        cur = c.p;
        break;
      }
      case 'Z':
        out.push({ t: 'Z' });
        cur = start;
        break;
    }
  }
  return out;
}

/** Split a command list into subpaths at every M. */
export function splitSubPaths(cmds: Cmd[]): SubPath[] {
  const out: SubPath[] = [];
  let cur: Cmd[] = [];
  let closed = false;
  const flush = (): void => {
    if (cur.length > 1) out.push({ cmds: cur, closed });
    cur = [];
    closed = false;
  };
  for (const c of cmds) {
    if (c.t === 'M') {
      flush();
      cur = [c];
    } else if (c.t === 'Z') {
      closed = true;
      flush();
    } else {
      cur.push(c);
    }
  }
  flush();
  return out;
}

/** Sample a subpath into a polyline. Closed subpaths repeat the first point last. */
export function flattenSubPath(sub: SubPath, tol: number): Pt[] {
  const pts: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };

  for (const c of sub.cmds) {
    switch (c.t) {
      case 'M':
        pts.push(c.p);
        cur = c.p;
        start = c.p;
        break;
      case 'L':
        pts.push(c.p);
        cur = c.p;
        break;
      case 'C':
        flattenCubic(cur, c.c1, c.c2, c.p, tol, pts);
        cur = c.p;
        break;
      case 'Q': {
        const [c1, c2] = quadToCubic(cur, c.c1, c.p);
        flattenCubic(cur, c1, c2, c.p, tol, pts);
        cur = c.p;
        break;
      }
      case 'A': {
        const arc = endpointToCenter(cur, c.rx, c.ry, c.rot, c.large, c.sweep, c.p);
        if (arc) flattenArc(arc, tol, pts);
        else pts.push(c.p);
        cur = c.p;
        break;
      }
      case 'Z':
        break;
    }
  }
  if (sub.closed && pts.length > 1) {
    const last = pts[pts.length - 1];
    if (Math.hypot(last.x - start.x, last.y - start.y) > 1e-9) pts.push({ ...start });
  }
  return pts;
}

export function cmdsToD(cmds: Cmd[], prec = 3): string {
  const f = (v: number): string => {
    const s = v.toFixed(prec);
    return s.replace(/\.?0+$/, '') || '0';
  };
  const parts: string[] = [];
  for (const c of cmds) {
    switch (c.t) {
      case 'M': parts.push(`M${f(c.p.x)} ${f(c.p.y)}`); break;
      case 'L': parts.push(`L${f(c.p.x)} ${f(c.p.y)}`); break;
      case 'C': parts.push(`C${f(c.c1.x)} ${f(c.c1.y)} ${f(c.c2.x)} ${f(c.c2.y)} ${f(c.p.x)} ${f(c.p.y)}`); break;
      case 'Q': parts.push(`Q${f(c.c1.x)} ${f(c.c1.y)} ${f(c.p.x)} ${f(c.p.y)}`); break;
      case 'A': parts.push(`A${f(c.rx)} ${f(c.ry)} ${f(c.rot)} ${c.large ? 1 : 0} ${c.sweep ? 1 : 0} ${f(c.p.x)} ${f(c.p.y)}`); break;
      case 'Z': parts.push('Z'); break;
    }
  }
  return parts.join('');
}
