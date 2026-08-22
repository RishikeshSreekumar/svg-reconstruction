<script lang="ts">
  import type { Fit, SegRef, Shape } from '../../../src/types.ts';
  import { deleteShape, editSegmentParam, editShapeParam, reorderShape, segmentFields, shapeFields } from '../../../src/index.ts';
  import { store } from '../state/scene.svelte.ts';
  import Icon from './Icon.svelte';
  import ParamRow from './ParamRow.svelte';

  let { s }: { s: Shape } = $props();

  const refKey = (r: SegRef): string => `${r.shape}#${r.contour}.${r.seg}`;

  const fields = $derived((store.rev, shapeFields(s)));
  const conf = $derived((store.rev, Math.round(s.meta.confidence * 100)));
  const col = $derived(conf >= 85 ? 'var(--good)' : conf >= 60 ? 'var(--warn)' : 'var(--bad)');
  const isSel = $derived(store.selected === s.id);
  const segNotes = $derived((store.rev, store.scene?.construction?.segs.filter((n) => n.ref.shape === s.id) ?? []));
  const selSegKey = $derived(store.selectedSeg ? refKey(store.selectedSeg) : null);

  function fitAt(r: SegRef): Fit | null {
    const shape = store.scene?.shapes.find((x) => x.id === r.shape);
    if (!shape || shape.kind !== 'path') return null;
    return shape.contours[r.contour]?.segs[r.seg] ?? null;
  }

  function editField(key: string, v: number): void {
    store.mutate((sc) => {
      editShapeParam(sc, s.id, key, v, store.editOpts());
      store.warning = '';
    });
  }

  function editSeg(ref: SegRef, key: string, v: number): void {
    store.mutate((sc) => store.track(editSegmentParam(sc, ref, key, v, store.editOpts())));
  }

  function toggleSeg(ref: SegRef): void {
    const same = selSegKey === refKey(ref);
    store.select(s.id, same ? null : ref);
  }

  function styleEdit(prop: 'fill' | 'stroke', raw: string): void {
    const v = raw.trim();
    store.mutate(
      (sc) => {
        const t = sc.shapes.find((x) => x.id === s.id);
        if (!t) return;
        t.style[prop] = v === '' || v === 'none' ? null : v;
        if (prop === 'stroke' && t.style.stroke && t.style.strokeWidth == null) t.style.strokeWidth = 1;
      },
      { commit: true },
    );
  }

  function textEdit(raw: string): void {
    store.mutate(
      (sc) => {
        const t = sc.shapes.find((x) => x.id === s.id);
        if (t && t.kind === 'text') t.text = raw;
      },
      { commit: true, rebuild: false },
    );
  }

  function anchorEdit(v: string): void {
    store.mutate(
      (sc) => {
        const t = sc.shapes.find((x) => x.id === s.id);
        if (t && t.kind === 'text' && (v === 'start' || v === 'middle' || v === 'end')) t.anchor = v;
      },
      { commit: true, rebuild: false },
    );
  }

  function remove(): void {
    store.mutate((sc) => deleteShape(sc, s.id), { commit: true, rebuild: false });
    if (store.selected === s.id) store.select(null);
  }

  function order(dir: 'forward' | 'backward'): void {
    store.mutate((sc) => reorderShape(sc, s.id, dir), { commit: true, rebuild: false });
  }
</script>

<div class="shape" class:sel={isSel} data-card={s.id}>
  <h3>
    <button class="bare" onclick={() => store.select(isSel ? null : s.id)}>
      <span class="kind">{s.kind}</span>
      <span class="sid">{s.id}</span>
    </button>
    <span class="tools">
      <button class="mini" title="Send backward" aria-label="Send {s.id} backward" onclick={() => order('backward')}><Icon name="down" size={12} /></button>
      <button class="mini" title="Bring forward" aria-label="Bring {s.id} forward" onclick={() => order('forward')}><Icon name="up" size={12} /></button>
      <button class="mini danger" title="Delete shape" aria-label="Delete {s.id}" onclick={remove}><Icon name="trash" size={12} /></button>
      <span class="conf" style:color={col} title="Reconstruction confidence — how sure the fit is">{conf}%</span>
    </span>
  </h3>
  <div class="bar"><i style:width="{conf}%" style:background={col}></i></div>

  {#if s.kind === 'text'}
    <div class="textrow">
      <input class="text" aria-label="Text content" value={s.text} oninput={(e) => textEdit((e.target as HTMLInputElement).value)} />
      <select aria-label="Text anchor" value={s.anchor} onchange={(e) => anchorEdit((e.target as HTMLSelectElement).value)}>
        <option value="start">start</option>
        <option value="middle">middle</option>
        <option value="end">end</option>
      </select>
    </div>
  {/if}

  {#if fields.length}
    <div class="params">
      {#each fields as f (f.key)}
        <ParamRow label={f.label} value={f.value} deg={f.deg} onchange={(v) => editField(f.key, v)} />
      {/each}
    </div>
  {/if}

  <div class="stylerow">
    <label for="fill-{s.id}">fill</label>
    <input id="fill-{s.id}" value={s.style.fill ?? 'none'} onchange={(e) => styleEdit('fill', (e.target as HTMLInputElement).value)} />
    <label for="stroke-{s.id}">stroke</label>
    <input id="stroke-{s.id}" value={s.style.stroke ?? 'none'} onchange={(e) => styleEdit('stroke', (e.target as HTMLInputElement).value)} />
  </div>

  {#if s.meta.note}<div class="note">{s.meta.note}</div>{/if}

  {#if s.kind === 'path' && segNotes.length}
    <div class="segs">
      <span class="h i">#</span><span class="h">kind</span><span class="h">value</span><span class="h j">join</span>
      {#each segNotes as n (refKey(n.ref))}
        {@const key = refKey(n.ref)}
        {@const open = selSegKey === key}
        <button class="bare i" onclick={() => toggleSeg(n.ref)}>{n.ref.seg}</button>
        <button class="bare k" onclick={() => toggleSeg(n.ref)}>{n.kind}</button>
        <button class="bare v" onclick={() => toggleSeg(n.ref)}>{n.value}</button>
        <button class="bare j" onclick={() => toggleSeg(n.ref)}>{n.relation}</button>
        {#if open}
          {@const f = fitAt(n.ref)}
          {#if f}
            <div class="segparams">
              <div class="params wide">
                {#each segmentFields(f) as sf (sf.key)}
                  <ParamRow label={sf.label} value={sf.value} deg={sf.deg} onchange={(v) => editSeg(n.ref, sf.key, v)} />
                {/each}
              </div>
              <!-- Refusals land next to the field that caused them. -->
              {#if store.warning}<div class="segwarn" role="status">{store.warning}</div>{/if}
            </div>
          {/if}
        {/if}
      {/each}
    </div>
  {/if}
</div>
