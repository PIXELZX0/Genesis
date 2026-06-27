import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { html, LitElement, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";
import type { MemoryGraph, MemoryGraphEdge, MemoryGraphNode } from "../controllers/memory.ts";

interface SimNode extends SimulationNodeDatum {
  path: string;
  name: string;
  description?: string;
  type?: string;
  size: number;
  degree: number;
}

interface SimEdge extends SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
  edgeType: MemoryGraphEdge["type"];
  weight: number;
}

interface ThemeColors {
  text: string;
  muted: string;
  accent: string;
  card: string;
  mono: string;
}

const MIN_RADIUS = 5;
const MAX_RADIUS = 16;

/**
 * Obsidian-style force-directed memory graph rendered on a canvas. Registers as
 * `<memory-graph>` and is hosted via the exported `renderMemoryGraph` template.
 */
export class MemoryGraphView extends LitElement {
  @property({ attribute: false }) nodes: MemoryGraphNode[] = [];
  @property({ attribute: false }) edges: MemoryGraphEdge[] = [];
  @property({ attribute: false }) onSelect?: (node: MemoryGraphNode | null) => void;

  @state() private selected: SimNode | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private simulation: Simulation<SimNode, SimEdge> | null = null;
  private simNodes: SimNode[] = [];
  private simEdges: SimEdge[] = [];
  private transform: ZoomTransform = zoomIdentity;
  private zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dragNode: SimNode | null = null;
  private width = 0;
  private height = 0;

  protected createRenderRoot(): HTMLElement {
    // Light DOM so theme CSS variables and global card styles apply directly.
    return this;
  }

  protected firstUpdated(): void {
    this.canvas = this.querySelector<HTMLCanvasElement>("canvas.memory-graph-canvas");
    if (!this.canvas) {
      return;
    }
    this.setupZoom(this.canvas);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
    this.buildSimulation();
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("nodes") || changed.has("edges")) {
      this.buildSimulation();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.simulation?.stop();
    this.simulation = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.canvas) {
      this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
      this.zoomBehavior?.on(".zoom", null);
    }
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
  }

  private themeColors(): ThemeColors {
    const styles = getComputedStyle(this);
    const pick = (name: string, fallback: string): string => {
      const value = styles.getPropertyValue(name).trim();
      return value.length > 0 ? value : fallback;
    };
    return {
      text: pick("--text", "#e6e6e6"),
      muted: pick("--muted", "#8a8a8a"),
      accent: pick("--accent", "#3b82f6"),
      card: pick("--card", "#111111"),
      mono: pick("--mono", "monospace"),
    };
  }

  private setupZoom(canvas: HTMLCanvasElement): void {
    const behavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 6])
      .filter((event: Event) => {
        // Allow wheel zoom and background pan, but let node drags bypass zoom.
        if (event.type === "mousedown" || event.type === "pointerdown") {
          return this.pickNode(event as PointerEvent) === null;
        }
        return true;
      })
      .on("zoom", (event: { transform: ZoomTransform }) => {
        this.transform = event.transform;
        this.draw();
      });
    select(canvas).call(behavior);
    this.zoomBehavior = behavior;
  }

  private resize(): void {
    if (!this.canvas) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    if (this.simulation) {
      this.simulation.force("center", forceCenter(this.width / 2, this.height / 2));
      this.simulation.alpha(0.3).restart();
    }
    this.draw();
  }

  private buildSimulation(): void {
    this.simulation?.stop();
    if (this.nodes.length === 0) {
      this.simNodes = [];
      this.simEdges = [];
      this.simulation = null;
      this.draw();
      return;
    }

    const degree = new Map<string, number>();
    for (const edge of this.edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }

    this.simNodes = this.nodes.map((node) => ({
      path: node.path,
      name: node.name,
      description: node.description,
      type: node.type,
      size: node.size,
      degree: degree.get(node.path) ?? 0,
    }));
    const byPath = new Map(this.simNodes.map((node) => [node.path, node]));
    this.simEdges = this.edges
      .filter((edge) => byPath.has(edge.source) && byPath.has(edge.target))
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        edgeType: edge.type,
        weight: edge.weight,
      }));

    const sim = forceSimulation<SimNode, SimEdge>(this.simNodes)
      .force(
        "link",
        forceLink<SimNode, SimEdge>(this.simEdges)
          .id((node) => node.path)
          .distance(80)
          .strength((edge) => Math.min(1, edge.weight)),
      )
      .force("charge", forceManyBody<SimNode>().strength(-180))
      .force("center", forceCenter(this.width / 2, this.height / 2))
      .force(
        "collide",
        forceCollide<SimNode>().radius((node) => this.radiusOf(node) + 4),
      )
      .on("tick", () => this.draw());
    this.simulation = sim;
  }

  private radiusOf(node: SimNode): number {
    const base = Math.log2(Math.max(1, node.size) + 1) + node.degree * 0.6;
    return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, MIN_RADIUS + base));
  }

  private toCanvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas?.getBoundingClientRect();
    const offsetX = event.clientX - (rect?.left ?? 0);
    const offsetY = event.clientY - (rect?.top ?? 0);
    return {
      x: this.transform.invertX(offsetX),
      y: this.transform.invertY(offsetY),
    };
  }

  private pickNode(event: PointerEvent): SimNode | null {
    const point = this.toCanvasPoint(event);
    for (let i = this.simNodes.length - 1; i >= 0; i -= 1) {
      const node = this.simNodes[i];
      const nx = node.x ?? 0;
      const ny = node.y ?? 0;
      const r = this.radiusOf(node) + 3;
      if ((point.x - nx) ** 2 + (point.y - ny) ** 2 <= r * r) {
        return node;
      }
    }
    return null;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    const node = this.pickNode(event);
    if (!node) {
      return;
    }
    event.preventDefault();
    this.dragNode = node;
    node.fx = node.x;
    node.fy = node.y;
    this.simulation?.alphaTarget(0.3).restart();
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    this.selected = node;
    this.onSelect?.(this.toGraphNode(node));
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragNode) {
      return;
    }
    const point = this.toCanvasPoint(event);
    this.dragNode.fx = point.x;
    this.dragNode.fy = point.y;
  };

  private handlePointerUp = (): void => {
    if (this.dragNode) {
      this.dragNode.fx = null;
      this.dragNode.fy = null;
      this.dragNode = null;
    }
    this.simulation?.alphaTarget(0);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
  };

  private toGraphNode(node: SimNode): MemoryGraphNode {
    return {
      name: node.name,
      path: node.path,
      description: node.description,
      type: node.type,
      size: node.size,
      mtimeMs: 0,
    };
  }

  private edgeStyle(
    edge: SimEdge,
    theme: ThemeColors,
  ): { color: string; dashed: boolean; width: number } {
    const width = Math.max(0.5, Math.min(4, edge.weight * 2));
    if (edge.edgeType === "wikilink") {
      return { color: theme.accent, dashed: false, width };
    }
    if (edge.edgeType === "tag") {
      return { color: theme.muted, dashed: true, width };
    }
    return {
      color: hexWithAlpha(theme.muted, 0.35),
      dashed: false,
      width: Math.max(0.5, width - 1),
    };
  }

  private draw(): void {
    const canvas = this.canvas;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const theme = this.themeColors();

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.translate(this.transform.x, this.transform.y);
    ctx.scale(this.transform.k, this.transform.k);

    for (const edge of this.simEdges) {
      const source = edge.source as SimNode;
      const target = edge.target as SimNode;
      if (typeof source !== "object" || typeof target !== "object") {
        continue;
      }
      const style = this.edgeStyle(edge, theme);
      ctx.beginPath();
      ctx.moveTo(source.x ?? 0, source.y ?? 0);
      ctx.lineTo(target.x ?? 0, target.y ?? 0);
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.width / this.transform.k;
      ctx.setLineDash(style.dashed ? [4 / this.transform.k, 3 / this.transform.k] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const showLabels = this.transform.k > 0.6;
    for (const node of this.simNodes) {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = this.radiusOf(node);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = node === this.selected ? theme.accent : theme.text;
      ctx.fill();
      if (node === this.selected) {
        ctx.lineWidth = 2 / this.transform.k;
        ctx.strokeStyle = theme.accent;
        ctx.stroke();
      }
      if (showLabels) {
        ctx.fillStyle = theme.muted;
        ctx.font = `${11 / this.transform.k}px ${theme.mono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(node.name, x, y + r + 2 / this.transform.k);
      }
    }
    ctx.restore();
  }

  render() {
    if (this.nodes.length === 0) {
      return html`<div class="muted" style="padding: 16px;">${t("memoryView.graphEmpty")}</div>`;
    }
    return html`
      <div
        style="position: relative; width: 100%; height: 520px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--card);"
      >
        <canvas
          class="memory-graph-canvas"
          style="display: block; width: 100%; height: 100%; touch-action: none;"
        ></canvas>
        ${this.selected
          ? html`
              <div
                style="position: absolute; top: 12px; right: 12px; max-width: 260px; padding: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.25);"
              >
                <div style="font-family: var(--mono); color: var(--text); word-break: break-word;">
                  ${this.selected.name}
                </div>
                ${this.selected.type
                  ? html`<div class="muted" style="margin-top: 4px; font-size: 12px;">
                      ${t("memoryView.nodeType")}: ${this.selected.type}
                    </div>`
                  : nothing}
                ${this.selected.description
                  ? html`<div class="muted" style="margin-top: 6px; font-size: 12px;">
                      ${this.selected.description}
                    </div>`
                  : nothing}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

function hexWithAlpha(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  return color;
}

if (!customElements.get("memory-graph")) {
  customElements.define("memory-graph", MemoryGraphView);
}

declare global {
  interface HTMLElementTagNameMap {
    "memory-graph": MemoryGraphView;
  }
}

export interface MemoryGraphProps {
  graph: MemoryGraph;
  onSelect: (node: MemoryGraphNode | null) => void;
}

/** Host template for the `<memory-graph>` element, consistent with `renderMemory`. */
export function renderMemoryGraph(props: MemoryGraphProps) {
  return html`<memory-graph
    .nodes=${props.graph.nodes}
    .edges=${props.graph.edges}
    .onSelect=${props.onSelect}
  ></memory-graph>`;
}
