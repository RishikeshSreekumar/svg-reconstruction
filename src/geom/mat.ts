import type { Mat, Pt } from '../types.ts';

export const IDENT: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** m1 then m2 applied to a point == apply(mul(m2, m1), p). */
export function matMul(m2: Mat, m1: Mat): Mat {
  return {
    a: m2.a * m1.a + m2.c * m1.b,
    b: m2.b * m1.a + m2.d * m1.b,
    c: m2.a * m1.c + m2.c * m1.d,
    d: m2.b * m1.c + m2.d * m1.d,
    e: m2.a * m1.e + m2.c * m1.f + m2.e,
    f: m2.b * m1.e + m2.d * m1.f + m2.f,
  };
}

export function apply(m: Mat, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Vector transform — ignores translation. */
export function applyVec(m: Mat, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y };
}

export const det = (m: Mat): number => m.a * m.d - m.b * m.c;

/** True when the matrix scales uniformly and has no shear (circles stay circles). */
export function isSimilarity(m: Mat, eps = 1e-6): boolean {
  const sx = Math.hypot(m.a, m.b);
  const sy = Math.hypot(m.c, m.d);
  if (Math.abs(sx - sy) > eps * Math.max(1, sx)) return false;
  return Math.abs(m.a * m.c + m.b * m.d) <= eps * Math.max(1, sx * sy);
}

/** Uniform scale factor; for non-similarity matrices returns sqrt(|det|). */
export function scaleOf(m: Mat): number {
  return Math.sqrt(Math.abs(det(m))) || 1;
}

const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/** Parse an SVG `transform` attribute into a single matrix. */
export function parseTransform(s: string | null | undefined): Mat {
  if (!s) return IDENT;
  let m = IDENT;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(s))) {
    const name = hit[1];
    const n = (hit[2].match(NUM) ?? []).map(Number);
    let t: Mat = IDENT;
    switch (name) {
      case 'matrix':
        t = { a: n[0] ?? 1, b: n[1] ?? 0, c: n[2] ?? 0, d: n[3] ?? 1, e: n[4] ?? 0, f: n[5] ?? 0 };
        break;
      case 'translate':
        t = { ...IDENT, e: n[0] ?? 0, f: n[1] ?? 0 };
        break;
      case 'scale': {
        const sx = n[0] ?? 1;
        t = { ...IDENT, a: sx, d: n.length > 1 ? n[1] : sx };
        break;
      }
      case 'rotate': {
        const rad = ((n[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rot: Mat = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
        if (n.length >= 3) {
          const cx = n[1];
          const cy = n[2];
          t = matMul(matMul({ ...IDENT, e: cx, f: cy }, rot), { ...IDENT, e: -cx, f: -cy });
        } else {
          t = rot;
        }
        break;
      }
      case 'skewX':
        t = { ...IDENT, c: Math.tan(((n[0] ?? 0) * Math.PI) / 180) };
        break;
      case 'skewY':
        t = { ...IDENT, b: Math.tan(((n[0] ?? 0) * Math.PI) / 180) };
        break;
    }
    m = matMul(m, t);
  }
  return m;
}
