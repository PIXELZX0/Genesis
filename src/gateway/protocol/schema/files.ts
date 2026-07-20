import { Type } from "typebox";
import { NonEmptyString } from "./primitives.js";

const FileEncodingSchema = Type.Union([Type.Literal("utf8"), Type.Literal("base64")]);

export const FilesEntrySchema = Type.Object(
  {
    name: NonEmptyString,
    type: Type.Union([
      Type.Literal("file"),
      Type.Literal("dir"),
      Type.Literal("symlink"),
      Type.Literal("other"),
    ]),
    size: Type.Optional(Type.Integer({ minimum: 0 })),
    mtimeMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const FilesListParamsSchema = Type.Object(
  {
    path: NonEmptyString,
  },
  { additionalProperties: false },
);

export const FilesListResultSchema = Type.Object(
  {
    path: NonEmptyString,
    entries: Type.Array(FilesEntrySchema),
  },
  { additionalProperties: false },
);

export const FilesReadParamsSchema = Type.Object(
  {
    path: NonEmptyString,
    encoding: Type.Optional(FileEncodingSchema),
  },
  { additionalProperties: false },
);

export const FilesReadResultSchema = Type.Object(
  {
    path: NonEmptyString,
    size: Type.Integer({ minimum: 0 }),
    mtimeMs: Type.Integer({ minimum: 0 }),
    encoding: FileEncodingSchema,
    content: Type.String(),
  },
  { additionalProperties: false },
);

export const FilesWriteParamsSchema = Type.Object(
  {
    path: NonEmptyString,
    content: Type.String(),
    encoding: Type.Optional(FileEncodingSchema),
    overwrite: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const FilesWriteResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    path: NonEmptyString,
    size: Type.Integer({ minimum: 0 }),
    mtimeMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const FilesDeleteParamsSchema = Type.Object(
  {
    path: NonEmptyString,
    recursive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const FilesRenameParamsSchema = Type.Object(
  {
    path: NonEmptyString,
    newPath: NonEmptyString,
  },
  { additionalProperties: false },
);

export const FilesMkdirParamsSchema = Type.Object(
  {
    path: NonEmptyString,
  },
  { additionalProperties: false },
);

export const FilesOkResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
  },
  { additionalProperties: false },
);
