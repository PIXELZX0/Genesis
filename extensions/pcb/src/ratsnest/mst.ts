import { padCenter } from "../model/geometry.js";
import type { BoardModel, Point } from "../model/types.js";

export type Airwire = { net: string; from: Point; to: Point };

const COINCIDENCE_TOL = 0.05;

class UnionFind {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) {
      this.parent[ra] = rb;
    }
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function collectNetNodes(board: BoardModel, netName: string): Point[] {
  const net = board.nets.find((n) => n.name === netName);
  if (!net) {
    return [];
  }
  const nodes: Point[] = [];
  for (const pin of net.pins) {
    const footprint = board.footprints.find((fp) => fp.refDes === pin.refDes);
    if (!footprint) {
      continue;
    }
    const pad = footprint.pads.find((p) => p.pinNumber === pin.pin);
    if (!pad) {
      continue;
    }
    nodes.push(padCenter(footprint, pad));
  }
  return nodes;
}

function ratsnestForNet(board: BoardModel, netName: string): Airwire[] {
  const nodes = collectNetNodes(board, netName);
  if (nodes.length < 2) {
    return [];
  }
  const uf = new UnionFind(nodes.length);

  // Pre-seed connectivity from existing routing: nodes coincident with a trace
  // vertex (or via) are treated as already connected.
  const seedPoints: Point[][] = [];
  for (const trace of board.traces) {
    if (trace.net === netName) {
      seedPoints.push(trace.points);
    }
  }
  for (const via of board.vias) {
    if (via.net === netName) {
      seedPoints.push([via.position]);
    }
  }
  for (const points of seedPoints) {
    const touched: number[] = [];
    nodes.forEach((node, index) => {
      if (points.some((p) => distance(node, p) <= COINCIDENCE_TOL)) {
        touched.push(index);
      }
    });
    for (let i = 1; i < touched.length; i++) {
      uf.union(touched[0], touched[i]);
    }
  }

  const edges: { i: number; j: number; weight: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      edges.push({ i, j, weight: distance(nodes[i], nodes[j]) });
    }
  }
  const sortedEdges = edges.toSorted((a, b) => a.weight - b.weight || a.i - b.i || a.j - b.j);

  const airwires: Airwire[] = [];
  for (const edge of sortedEdges) {
    if (uf.find(edge.i) !== uf.find(edge.j)) {
      uf.union(edge.i, edge.j);
      airwires.push({ net: netName, from: nodes[edge.i], to: nodes[edge.j] });
    }
  }
  return airwires;
}

/** Unrouted airwires for every net on the board, via per-net Kruskal MST. */
export function computeRatsnest(board: BoardModel): Airwire[] {
  return board.nets.flatMap((net) => ratsnestForNet(board, net.name));
}
