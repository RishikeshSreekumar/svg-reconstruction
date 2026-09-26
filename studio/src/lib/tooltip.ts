import type { Action } from 'svelte/action';

/**
 * Instant tooltips. The native `title` attribute waits about a second before
 * showing — far too slow for a tool where every chip and rail button explains
 * itself on hover. One shared element serves the whole app: show after a short
 * delay, instantly while moving between neighbouring controls, and never under
 * the pointer's way (`pointer-events: none`).
 *
 * Triggers keep their own accessible names (`aria-label` or text content);
 * the tip itself is aria-hidden so screen readers never hear things twice.
 */

type Place = 'top' | 'bottom' | 'right';
type TipInput = string | null | undefined | { text: string | null | undefined; place?: Place };

const DELAY_MS = 120;
/** Moving between controls within this window shows the next tip instantly. */
const WARM_MS = 350;
const GAP = 7;
const PAD = 8;

let tipEl: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let lastHide = 0;

function el(): HTMLDivElement {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'ui-tip';
    tipEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function onScroll(): void {
  hide();
}

function hide(node?: HTMLElement): void {
  if (node && owner !== node) return;
  clearTimeout(showTimer);
  if (tipEl?.classList.contains('show')) lastHide = performance.now();
  owner = null;
  tipEl?.classList.remove('show');
  window.removeEventListener('scroll', onScroll, true);
}

function position(node: HTMLElement, prefer: Place): void {
  const t = el();
  const r = node.getBoundingClientRect();
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x: number;
  let y: number;
  if (prefer === 'right') {
    x = r.right + GAP;
    y = r.top + r.height / 2 - h / 2;
    if (x + w > vw - PAD) x = r.left - GAP - w;
  } else {
    x = r.left + r.width / 2 - w / 2;
    y = prefer === 'bottom' ? r.bottom + GAP : r.top - GAP - h;
    // Flip rather than cover the trigger when the preferred side is clipped.
    if (prefer === 'top' && y < PAD) y = r.bottom + GAP;
    if (prefer === 'bottom' && y + h > vh - PAD) y = r.top - GAP - h;
  }
  t.style.left = `${Math.min(vw - PAD - w, Math.max(PAD, x))}px`;
  t.style.top = `${Math.min(vh - PAD - h, Math.max(PAD, y))}px`;
}

export const tooltip: Action<HTMLElement, TipInput> = (node, input) => {
  let text = '';
  let prefer: Place = 'top';

  const parse = (i: TipInput): void => {
    if (i && typeof i === 'object') {
      text = i.text ?? '';
      prefer = i.place ?? 'top';
    } else {
      text = i ?? '';
      prefer = 'top';
    }
  };
  parse(input);

  function show(): void {
    if (!text) return;
    const t = el();
    t.textContent = text;
    t.classList.add('show');
    position(node, prefer);
    window.addEventListener('scroll', onScroll, true);
  }

  function schedule(): void {
    if (!text) return;
    clearTimeout(showTimer);
    owner = node;
    showTimer = setTimeout(show, performance.now() - lastHide < WARM_MS ? 0 : DELAY_MS);
  }

  // Keyboard focus deserves the same explanation, but a click must not flash one.
  function onFocus(): void {
    if (node.matches(':focus-visible')) schedule();
  }
  const leave = (): void => hide(node);

  node.addEventListener('pointerenter', schedule);
  node.addEventListener('pointerleave', leave);
  node.addEventListener('pointerdown', leave);
  node.addEventListener('focus', onFocus);
  node.addEventListener('blur', leave);

  return {
    update(i: TipInput): void {
      parse(i);
      if (owner === node && tipEl?.classList.contains('show')) {
        if (!text) hide(node);
        else {
          tipEl.textContent = text;
          position(node, prefer);
        }
      }
    },
    destroy(): void {
      hide(node);
      node.removeEventListener('pointerenter', schedule);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('pointerdown', leave);
      node.removeEventListener('focus', onFocus);
      node.removeEventListener('blur', leave);
    },
  };
};
