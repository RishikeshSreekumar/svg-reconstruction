export type ToolId =
  | 'select'
  | 'pan'
  | 'circle'
  | 'ellipse'
  | 'rect'
  | 'line'
  | 'polygon'
  | 'curve'
  | 'text'
  | 'guide-h'
  | 'guide-v'
  | 'guide-angle';

export type ToolGroup = 'nav' | 'shape' | 'guide';

export interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  title: string;
  /** Icon name in icons.ts; defaults to the tool id. */
  icon: string;
  group: ToolGroup;
}

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', key: 'v', title: 'Select / move (V)', icon: 'select', group: 'nav' },
  { id: 'pan', label: 'Pan', key: 'h', title: 'Pan the canvas (H, or hold Space)', icon: 'pan', group: 'nav' },
  { id: 'circle', label: 'Circle', key: 'c', title: 'Add circle (C) — click, or drag to size', icon: 'circle', group: 'shape' },
  { id: 'ellipse', label: 'Ellipse', key: 'e', title: 'Add ellipse (E) — click, or drag to size', icon: 'ellipse', group: 'shape' },
  { id: 'rect', label: 'Rect', key: 'r', title: 'Add rectangle (R) — click, or drag to size', icon: 'rect', group: 'shape' },
  { id: 'line', label: 'Line', key: 'l', title: 'Add line (L) — click, or drag to size', icon: 'line', group: 'shape' },
  { id: 'polygon', label: 'Polygon', key: 'p', title: 'Add regular polygon (P) — click, or drag to size', icon: 'polygon', group: 'shape' },
  { id: 'curve', label: 'Curve', key: 'b', title: 'Add bezier curve (B) — click, or drag to span it, then shape it by its control handles', icon: 'curve', group: 'shape' },
  { id: 'text', label: 'Text', key: 't', title: 'Add text (T)', icon: 'text', group: 'shape' },
  { id: 'guide-h', label: 'H guide', key: 'g', title: 'Add horizontal guideline (G)', icon: 'guide-h', group: 'guide' },
  { id: 'guide-v', label: 'V guide', key: 'j', title: 'Add vertical guideline (J)', icon: 'guide-v', group: 'guide' },
  { id: 'guide-angle', label: 'Sloped guide', key: 'k', title: 'Add sloped guideline (K) — drag to set the angle', icon: 'guide-angle', group: 'guide' },
];

export const TOOL_GROUPS: ToolGroup[] = ['nav', 'shape', 'guide'];

class Tools {
  current: ToolId = $state('select');
  /** Space temporarily switches to pan without losing the chosen tool. */
  spaceHeld = $state(false);

  get effective(): ToolId {
    return this.spaceHeld ? 'pan' : this.current;
  }

  set(id: ToolId): void {
    this.current = id;
  }
}

export const tools = new Tools();
