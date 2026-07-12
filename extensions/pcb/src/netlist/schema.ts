import { z } from "zod";

export const NetlistComponentSchema = z.object({
  refDes: z.string(),
  footprintId: z.string(),
  value: z.string().optional(),
  group: z.string().optional(),
});

export const NetlistNetSchema = z.object({
  name: z.string(),
  pins: z.array(z.object({ refDes: z.string(), pin: z.string() })),
});

export const NetlistSchema = z.object({
  components: z.array(NetlistComponentSchema),
  nets: z.array(NetlistNetSchema),
});

export type Netlist = z.infer<typeof NetlistSchema>;
export type NetlistComponent = z.infer<typeof NetlistComponentSchema>;
