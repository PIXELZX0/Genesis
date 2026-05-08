import { Type } from "typebox";
import { NonEmptyString } from "./primitives.js";

export const CanvasDocumentKindSchema = Type.String({
  enum: [
    "html_bundle",
    "url_embed",
    "document",
    "image",
    "video_asset",
    "presentation_asset",
    "model_3d",
    "vector_image",
  ],
});

export const CanvasDocumentSurfaceSchema = Type.String({
  enum: ["assistant_message", "tool_card", "sidebar"],
});

export const CanvasDocumentAssetSchema = Type.Object(
  {
    logicalPath: NonEmptyString,
    sourcePath: NonEmptyString,
    contentType: Type.Optional(NonEmptyString),
    role: Type.Optional(Type.String({ enum: ["source", "sidecar", "texture"] })),
  },
  { additionalProperties: false },
);

const CanvasDocumentMutationProperties = {
  kind: Type.Optional(CanvasDocumentKindSchema),
  title: Type.Optional(NonEmptyString),
  preferredHeight: Type.Optional(Type.Number()),
  surface: Type.Optional(CanvasDocumentSurfaceSchema),
  html: Type.Optional(Type.String({ minLength: 1 })),
  path: Type.Optional(NonEmptyString),
  url: Type.Optional(NonEmptyString),
  workspaceDir: Type.Optional(NonEmptyString),
  assets: Type.Optional(Type.Array(CanvasDocumentAssetSchema)),
  sourceMime: Type.Optional(NonEmptyString),
  sourceFileName: Type.Optional(NonEmptyString),
  viewerOptions: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
};

export const CanvasDocumentCreateParamsSchema = Type.Object(
  {
    id: Type.Optional(NonEmptyString),
    ...CanvasDocumentMutationProperties,
  },
  { additionalProperties: false },
);

export const CanvasDocumentUpdateParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    ...CanvasDocumentMutationProperties,
  },
  { additionalProperties: false },
);

export const CanvasDocumentManifestAssetSchema = Type.Object(
  {
    logicalPath: NonEmptyString,
    contentType: Type.Optional(NonEmptyString),
    sourceFileName: Type.Optional(NonEmptyString),
    sizeBytes: Type.Optional(Type.Number()),
    role: Type.Optional(Type.String({ enum: ["source", "sidecar", "texture"] })),
  },
  { additionalProperties: false },
);

export const CanvasDocumentManifestSchema = Type.Object(
  {
    id: NonEmptyString,
    kind: CanvasDocumentKindSchema,
    title: Type.Optional(NonEmptyString),
    preferredHeight: Type.Optional(Type.Number()),
    createdAt: NonEmptyString,
    updatedAt: Type.Optional(NonEmptyString),
    revision: Type.Number(),
    entryUrl: NonEmptyString,
    localEntrypoint: Type.Optional(NonEmptyString),
    externalUrl: Type.Optional(NonEmptyString),
    sourceMime: Type.Optional(NonEmptyString),
    sourceFileName: Type.Optional(NonEmptyString),
    viewer: Type.Optional(
      Type.String({
        enum: [
          "html",
          "url",
          "pdf",
          "image",
          "video",
          "pptx",
          "ppt_fallback",
          "threejs",
          "svg",
          "download",
        ],
      }),
    ),
    viewerOptions: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    surface: Type.Optional(CanvasDocumentSurfaceSchema),
    assets: Type.Array(CanvasDocumentManifestAssetSchema),
  },
  { additionalProperties: false },
);

export const CanvasDocumentCreateResultSchema = CanvasDocumentManifestSchema;

export const CanvasDocumentListParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export const CanvasDocumentListResultSchema = Type.Object(
  {
    documents: Type.Array(CanvasDocumentManifestSchema),
  },
  { additionalProperties: false },
);
