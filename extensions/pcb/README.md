# @genesis/pcb

PCB design plugin for **Genesis** agents.

It gives agents one tool, `pcb`, that can build a printed-circuit-board model,
compute a ratsnest, export manufacturing files, and render a live SVG preview
for the canvas. The Gerber (RS-274X) and Excellon writers are hand-rolled — no
external EDA binary is required. Straight-line traces only; there is no
autorouter and no design-rule check.

It is disabled by default (`enabledByDefault: false`); enable it per workspace
in `~/.genesis/genesis.json`.

## What Agents Get

`render_preview` returns:

- `details.svgPath`: a composited PCB preview SVG (Gerber layers plus the
  ratsnest overlay) written under the board's workspace directory
- `details.instruction`: a reminder to pass `svgPath` to the `canvas` tool

`export_gerber` returns `details.files`: the written Gerber/Excellon paths.

The `pcb` tool never calls a canvas RPC itself — it produces an `.svg` file and
the agent passes the path to the existing `canvas` tool's `create`/`update`
action, where the `vector_image` kind is inferred from the `.svg` extension.

## Actions

| action                                        | purpose                                           |
| --------------------------------------------- | ------------------------------------------------- |
| `create_board` / `load_board` / `list_boards` | create, load, or list boards                      |
| `set_outline` / `set_layer_stack`             | set the board outline / copper stack              |
| `add_footprint` / `remove_footprint`          | add or remove a footprint                         |
| `set_net`                                     | define a net's pins                               |
| `import_netlist`                              | import components + nets (auto-places by default) |
| `auto_place`                                  | re-run deterministic grid placement               |
| `add_trace` / `remove_trace`                  | add or remove a routed trace                      |
| `add_via`                                     | add a layer-changing via                          |
| `add_copper_pour`                             | add a copper pour region                          |
| `compute_ratsnest`                            | list unrouted airwires per net                    |
| `export_gerber`                               | write Gerber + Excellon files                     |
| `render_preview`                              | render the preview SVG and return `svgPath`       |
| `get_board`                                   | dump the full board JSON                          |

## Built-in Footprints

`0603`, `0805` (two-pad passives), `SOIC-8`, and `THT-2` (generic 2-pin
through-hole). Add more in `src/footprints/library.ts`.

## Workspace Layout

```
<workspaceDir>/pcb/<board>/
  board.json      # validated BoardModel
  netlist.json    # last imported netlist (for re-placement)
  gerbers/board.{gtl,gbl,gts,gbs,gto,gbo,gko,drl}
  preview.svg
```

## Example Agent Prompt

```text
Use the `pcb` tool to build a small board named "blinky":
1. create_board name=blinky
2. import_netlist with an LED (THT-2), a resistor (0603), and a header (THT-2)
3. compute_ratsnest, then add_trace for each airwire on F.Cu
4. export_gerber, then render_preview
5. Pass the returned svgPath to the canvas tool's create action to show it.
```

## Notes

- Preview compositing is powered by [pcb-stackup](https://github.com/tracespace/tracespace).
- The ratsnest overlay is aligned to the composited viewBox with a linear map;
  it is a visual aid, not a manufacturing layer.
