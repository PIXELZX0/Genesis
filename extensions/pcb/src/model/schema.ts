import { z } from "zod";

export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const PadShapeSchema = z.enum(["circle", "rect", "roundrect", "oval"]);
export const PadLayerSchema = z.enum(["F.Cu", "B.Cu", "both"]);

export const PadSchema = z.object({
  id: z.string(),
  pinNumber: z.string(),
  shape: PadShapeSchema,
  size: z.object({ w: z.number().positive(), h: z.number().positive() }),
  offset: PointSchema,
  drillMm: z.number().positive().optional(),
  layer: PadLayerSchema,
  net: z.string().optional(),
});

export const FootprintSchema = z.object({
  refDes: z.string(),
  footprintId: z.string(),
  position: PointSchema,
  rotationDeg: z.number(),
  side: z.enum(["top", "bottom"]),
  pads: z.array(PadSchema),
});

export const TraceSchema = z.object({
  id: z.string(),
  net: z.string(),
  layer: z.string(),
  widthMm: z.number().positive(),
  points: z.array(PointSchema).min(2),
});

export const ViaSchema = z.object({
  id: z.string(),
  net: z.string(),
  position: PointSchema,
  drillMm: z.number().positive(),
  padDiaMm: z.number().positive(),
  fromLayer: z.string(),
  toLayer: z.string(),
});

export const CopperPourSchema = z.object({
  id: z.string(),
  net: z.string(),
  layer: z.string(),
  outline: z.array(PointSchema).min(3),
});

export const NetSchema = z.object({
  name: z.string(),
  pins: z.array(z.object({ refDes: z.string(), pin: z.string() })),
});

export const BoardModelSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  units: z.literal("mm"),
  outline: z.array(PointSchema),
  layerStack: z.object({ copperLayers: z.array(z.string()) }),
  footprints: z.array(FootprintSchema),
  nets: z.array(NetSchema),
  traces: z.array(TraceSchema),
  vias: z.array(ViaSchema),
  pours: z.array(CopperPourSchema),
});
