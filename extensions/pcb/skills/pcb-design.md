---
name: pcb-design
description: Design a PCB with the `pcb` tool — place footprints from a netlist, compute the ratsnest, route traces, export Gerber/Excellon, and preview it in Canvas.
---

# PCB Design Workflow

The `pcb` tool builds a board model on disk under `<workspace>/pcb/<board>/` and
exports manufacturing files. Units are millimeters. Straight-line traces only
(no arcs). There is no autorouter and no DRC — you place and route deliberately.

## Steps

1. **Create the board.**
   `pcb create_board name=<board>` — starts an empty board with an `F.Cu`/`B.Cu`
   stack and a default rectangular outline. Adjust with `set_outline` (an array
   of `{x,y}` points) and `set_layer_stack` (`copperLayers`).

2. **Add parts.** Two ways:
   - `pcb import_netlist name=<board> netlist={components,nets}` — the fastest
     path. Each component is `{refDes, footprintId, value?, group?}`. Built-in
     footprints: `0603`, `0805`, `SOIC-8`, `THT-2`. With `autoPlace` (default
     true) components are placed on a deterministic per-group grid.
   - `pcb add_footprint name=<board> refDes=<R1> footprintId=<0603>` for a single
     part, then `pcb set_net net=<name> pins=[{refDes,pin}]` to define nets.

3. **Place.** `pcb auto_place name=<board>` re-runs grid placement (groups laid
   left-to-right, packed into `ceil(sqrt(n))` columns). Or set positions per
   footprint yourself via `add_footprint position={x,y} rotationDeg side`.

4. **See what's unrouted.** `pcb compute_ratsnest name=<board>` returns the
   airwires (shortest unrouted connections per net). Route them one at a time.

5. **Route.** Loop:
   - `pcb add_trace name=<board> net=<n> layer=<F.Cu> widthMm=<0.25> points=[{x,y},...]`
   - `pcb add_via name=<board> net=<n> position={x,y} drillMm padDiaMm` to change layers.
   - `pcb add_copper_pour name=<board> net=<n> layer=<B.Cu> outline=[{x,y},...]`
   - `remove_trace id=<id>` to undo a trace.
     Re-run `compute_ratsnest` to confirm the net count drops.

6. **Export.** `pcb export_gerber name=<board>` writes
   `<workspace>/pcb/<board>/gerbers/board.{gtl,gbl,gts,gbs,gto,gbo,gko,drl}`.

7. **Preview in Canvas.** `pcb render_preview name=<board>` composites the
   Gerbers into `preview.svg` with the ratsnest overlaid, and returns `svgPath`.
   Then hand that path to the **`canvas`** tool:
   `canvas create sourcePath=<svgPath>` (the `vector_image` kind is inferred from
   the `.svg` extension). Do not call any canvas RPC from the `pcb` tool — it only
   produces the file.

## Notes

- `get_board name=<board>` dumps the full board JSON for inspection.
- `list_boards` / `load_board` manage multiple boards in one workspace.
- Re-run `render_preview` after routing changes to refresh the Canvas view.
