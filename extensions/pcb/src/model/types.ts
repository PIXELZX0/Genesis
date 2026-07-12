import type { z } from "zod";
import type {
  BoardModelSchema,
  CopperPourSchema,
  FootprintSchema,
  NetSchema,
  PadSchema,
  PointSchema,
  TraceSchema,
  ViaSchema,
} from "./schema.js";

export type Point = z.infer<typeof PointSchema>;
export type Pad = z.infer<typeof PadSchema>;
export type Footprint = z.infer<typeof FootprintSchema>;
export type Trace = z.infer<typeof TraceSchema>;
export type Via = z.infer<typeof ViaSchema>;
export type CopperPour = z.infer<typeof CopperPourSchema>;
export type Net = z.infer<typeof NetSchema>;
export type BoardModel = z.infer<typeof BoardModelSchema>;
