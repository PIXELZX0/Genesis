import { Type } from "typebox";
import { NonEmptyString } from "./primitives.js";

export const CanvasDocumentKindSchema = Type.String({
  enum: ["html_bundle", "url_embed", "document", "image", "video_asset"],
});

export const CanvasDocumentSurfaceSchema = Type.String({
  enum: ["assistant_message", "tool_card", "sidebar"],
});

export const CanvasDocumentAssetSchema = Type.Object(
  {
    logicalPath: NonEmptyString,
    sourcePath: NonEmptyString,
    contentType: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const CanvasDocumentCreateParamsSchema = Type.Object(
  {
    id: Type.Optional(NonEmptyString),
    kind: Type.Optional(CanvasDocumentKindSchema),
    title: Type.Optional(NonEmptyString),
    preferredHeight: Type.Optional(Type.Number()),
    surface: Type.Optional(CanvasDocumentSurfaceSchema),
    html: Type.Optional(Type.String({ minLength: 1 })),
    path: Type.Optional(NonEmptyString),
    url: Type.Optional(NonEmptyString),
    workspaceDir: Type.Optional(NonEmptyString),
    assets: Type.Optional(Type.Array(CanvasDocumentAssetSchema)),
  },
  { additionalProperties: false },
);

export const CanvasDocumentManifestAssetSchema = Type.Object(
  {
    logicalPath: NonEmptyString,
    contentType: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const CanvasDocumentCreateResultSchema = Type.Object(
  {
    id: NonEmptyString,
    kind: CanvasDocumentKindSchema,
    title: Type.Optional(NonEmptyString),
    preferredHeight: Type.Optional(Type.Number()),
    createdAt: NonEmptyString,
    entryUrl: NonEmptyString,
    localEntrypoint: Type.Optional(NonEmptyString),
    externalUrl: Type.Optional(NonEmptyString),
    surface: Type.Optional(CanvasDocumentSurfaceSchema),
    assets: Type.Array(CanvasDocumentManifestAssetSchema),
  },
  { additionalProperties: false },
);
