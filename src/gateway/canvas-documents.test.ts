import { mkdtemp, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCanvasDocumentEntryUrl,
  createCanvasDocument,
  inferCanvasDocumentKindFromSource,
  resolveCanvasDocumentAssets,
  resolveCanvasDocumentDir,
  resolveCanvasDocumentRevisionDir,
  resolveCanvasHttpPathToLocalPath,
  updateCanvasDocument,
} from "./canvas-documents.js";

const tempDirs: string[] = [];

async function minimalPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
      '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
      "</Types>",
    ].join(""),
  );
  zip.file("ppt/presentation.xml", "<p:presentation/>");
  zip.file("ppt/slides/slide1.xml", "<p:sld/>");
  return await zip.generateAsync({ type: "nodebuffer" });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }),
  );
});

describe("canvas documents", () => {
  it("builds entry urls for materialized path documents under managed storage", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-workspace-"));
    tempDirs.push(workspaceDir);
    await mkdir(path.join(workspaceDir, "player"), { recursive: true });
    await writeFile(path.join(workspaceDir, "player/index.html"), "<div>ok</div>", "utf8");

    const document = await createCanvasDocument(
      {
        kind: "html_bundle",
        entrypoint: {
          type: "path",
          value: "player/index.html",
        },
      },
      { stateDir, workspaceDir },
    );

    expect(document.entryUrl).toContain("/__genesis__/canvas/documents/");
    expect(document.localEntrypoint).toBe("index.html");
    expect(resolveCanvasDocumentDir(document.id, { stateDir })).toContain(stateDir);
  });

  it("normalizes nested local entrypoint urls", () => {
    const url = buildCanvasDocumentEntryUrl("cv_example", "collection.media/index.html");
    expect(url).toBe("/__genesis__/canvas/documents/cv_example/collection.media/index.html");
  });

  it("encodes special characters in hosted entrypoint path segments", () => {
    const url = buildCanvasDocumentEntryUrl("cv_example", "bundle#1/entry%20point?.html");
    expect(url).toBe("/__genesis__/canvas/documents/cv_example/bundle%231/entry%2520point%3F.html");
  });

  it("materializes inline html bundles as index documents", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);

    const document = await createCanvasDocument(
      {
        kind: "html_bundle",
        title: "Preview",
        entrypoint: {
          type: "html",
          value:
            "<!doctype html><html><head><style>.demo{color:red}</style></head><body><div class='demo'>Front</div></body></html>",
        },
      },
      { stateDir },
    );

    const indexHtml = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        path.join(resolveCanvasDocumentDir(document.id, { stateDir }), "index.html"),
        "utf8",
      ),
    );

    expect(indexHtml).toContain("<div class='demo'>Front</div>");
    expect(indexHtml).toContain("<style>.demo{color:red}</style>");
    expect(document.title).toBe("Preview");
    expect(document.entryUrl).toBe(`/__genesis__/canvas/documents/${document.id}/index.html`);
  });

  it("reuses a supplied stable document id by replacing the prior materialized view", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);

    const first = await createCanvasDocument(
      {
        id: "status-card",
        kind: "html_bundle",
        entrypoint: { type: "html", value: "<div>first</div>" },
      },
      { stateDir },
    );
    const second = await createCanvasDocument(
      {
        id: "status-card",
        kind: "html_bundle",
        entrypoint: { type: "html", value: "<div>second</div>" },
      },
      { stateDir },
    );

    expect(first.id).toBe("status-card");
    expect(second.id).toBe("status-card");

    const indexHtml = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        path.join(resolveCanvasDocumentDir(second.id, { stateDir }), "index.html"),
        "utf8",
      ),
    );
    expect(indexHtml).toContain("second");
    expect(indexHtml).not.toContain("first");
    expect(second.revision).toBe(1);
  });

  it("updates a stable document through revision directories", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);

    const first = await createCanvasDocument(
      {
        id: "live-card",
        kind: "html_bundle",
        entrypoint: { type: "html", value: "<div>first</div>" },
      },
      { stateDir },
    );
    const second = await updateCanvasDocument(
      {
        id: "live-card",
        kind: "html_bundle",
        entrypoint: { type: "html", value: "<div>second</div>" },
      },
      { stateDir },
    );

    expect(first.entryUrl).toBe("/__genesis__/canvas/documents/live-card/index.html");
    expect(second.entryUrl).toBe(first.entryUrl);
    expect(second.revision).toBe(2);
    await expect(
      readFile(
        path.join(resolveCanvasDocumentRevisionDir("live-card", 1, { stateDir }), "index.html"),
        "utf8",
      ),
    ).resolves.toContain("first");
    await expect(
      readFile(
        path.join(resolveCanvasDocumentRevisionDir("live-card", 2, { stateDir }), "index.html"),
        "utf8",
      ),
    ).resolves.toContain("second");
    await expect(
      readFile(
        path.join(resolveCanvasDocumentDir("live-card", { stateDir }), "index.html"),
        "utf8",
      ),
    ).resolves.toContain("second");
  });

  it("infers rich canvas document kinds from source extensions", () => {
    expect(inferCanvasDocumentKindFromSource("deck.pptx", "path")).toBe("presentation_asset");
    expect(inferCanvasDocumentKindFromSource("deck.ppt", "path")).toBe("presentation_asset");
    expect(inferCanvasDocumentKindFromSource("shape.svg", "path")).toBe("vector_image");
    expect(inferCanvasDocumentKindFromSource("scene.glb", "path")).toBe("model_3d");
    expect(inferCanvasDocumentKindFromSource("scene.gltf", "path")).toBe("model_3d");
    expect(inferCanvasDocumentKindFromSource("mesh.obj", "path")).toBe("model_3d");
    expect(inferCanvasDocumentKindFromSource("mesh.stl", "path")).toBe("model_3d");
  });

  it("exposes stable managed asset urls for copied canvas assets", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-workspace-"));
    tempDirs.push(workspaceDir);
    await mkdir(path.join(workspaceDir, "collection.media"), { recursive: true });
    await writeFile(path.join(workspaceDir, "collection.media/audio.mp3"), "audio", "utf8");

    const document = await createCanvasDocument(
      {
        kind: "html_bundle",
        entrypoint: {
          type: "html",
          value:
            '<audio controls><source src="collection.media/audio.mp3" type="audio/mpeg" /></audio>',
        },
        assets: [
          {
            logicalPath: "collection.media/audio.mp3",
            sourcePath: "collection.media/audio.mp3",
            contentType: "audio/mpeg",
          },
        ],
      },
      { stateDir, workspaceDir },
    );

    expect(resolveCanvasDocumentAssets(document, { stateDir })).toEqual([
      expect.objectContaining({
        logicalPath: "collection.media/audio.mp3",
        contentType: "audio/mpeg",
        localPath: path.join(
          resolveCanvasDocumentDir(document.id, { stateDir }),
          "collection.media/audio.mp3",
        ),
        url: `/__genesis__/canvas/documents/${document.id}/collection.media/audio.mp3`,
      }),
    ]);
    expect(
      resolveCanvasDocumentAssets(document, {
        baseUrl: "http://127.0.0.1:19003",
        stateDir,
      }),
    ).toEqual([
      expect.objectContaining({
        logicalPath: "collection.media/audio.mp3",
        contentType: "audio/mpeg",
        localPath: path.join(
          resolveCanvasDocumentDir(document.id, { stateDir }),
          "collection.media/audio.mp3",
        ),
        url: `http://127.0.0.1:19003/__genesis__/canvas/documents/${document.id}/collection.media/audio.mp3`,
      }),
    ]);
  });

  it("wraps local pdf documents in an index viewer page", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-workspace-"));
    tempDirs.push(workspaceDir);
    await writeFile(path.join(workspaceDir, "demo.pdf"), "%PDF-1.4", "utf8");

    const document = await createCanvasDocument(
      {
        kind: "document",
        entrypoint: {
          type: "path",
          value: "demo.pdf",
        },
      },
      { stateDir, workspaceDir },
    );

    expect(document.entryUrl).toBe(`/__genesis__/canvas/documents/${document.id}/index.html`);
    const indexHtml = await readFile(
      path.join(resolveCanvasDocumentDir(document.id, { stateDir }), "index.html"),
      "utf8",
    );
    expect(indexHtml).toContain('type="application/pdf"');
    expect(indexHtml).toContain('data="demo.pdf"');
    expect(document.revision).toBe(1);
    expect(document.assets).toEqual([
      expect.objectContaining({
        logicalPath: "demo.pdf",
        contentType: "application/pdf",
        role: "source",
      }),
    ]);
  });

  it("wraps local pptx presentations with the bundled client viewer", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-workspace-"));
    tempDirs.push(workspaceDir);
    await writeFile(path.join(workspaceDir, "demo.pptx"), await minimalPptx());

    const document = await createCanvasDocument(
      {
        kind: "presentation_asset",
        entrypoint: {
          type: "path",
          value: "demo.pptx",
        },
      },
      { stateDir, workspaceDir },
    );

    expect(document.entryUrl).toBe(`/__genesis__/canvas/documents/${document.id}/index.html`);
    expect(document.sourceMime).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(document.viewer).toBe("pptx");
    expect(document.viewerOptions).toEqual(expect.objectContaining({ slideCount: 1 }));
    const indexHtml = await readFile(
      path.join(resolveCanvasDocumentDir(document.id, { stateDir }), "index.html"),
      "utf8",
    );
    expect(indexHtml).toContain("PptxViewJS.min.js");
    expect(indexHtml).toContain("Slide");
  });

  it("wraps legacy ppt files with a deterministic fallback when no converter exists", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-workspace-"));
    tempDirs.push(workspaceDir);
    await writeFile(path.join(workspaceDir, "legacy.ppt"), "ppt", "utf8");

    const document = await createCanvasDocument(
      {
        kind: "presentation_asset",
        entrypoint: {
          type: "path",
          value: "legacy.ppt",
        },
      },
      { stateDir, workspaceDir },
    );

    const indexHtml = await readFile(
      path.join(resolveCanvasDocumentDir(document.id, { stateDir }), "index.html"),
      "utf8",
    );
    expect(document.viewer).toBe("ppt_fallback");
    expect(indexHtml).toContain("Convert this file to PPTX");
    expect(indexHtml).toContain("Open original");
  });

  it("wraps local SVG through an image element instead of inline SVG", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-workspace-"));
    tempDirs.push(workspaceDir);
    await writeFile(
      path.join(workspaceDir, "shape.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="8"/></svg>',
      "utf8",
    );

    const document = await createCanvasDocument(
      {
        kind: "vector_image",
        entrypoint: {
          type: "path",
          value: "shape.svg",
        },
      },
      { stateDir, workspaceDir },
    );

    const indexHtml = await readFile(
      path.join(resolveCanvasDocumentDir(document.id, { stateDir }), "index.html"),
      "utf8",
    );
    expect(document.viewer).toBe("svg");
    expect(indexHtml).toContain('<img id="image" src="shape.svg"');
    expect(indexHtml).not.toContain("<circle");
  });

  it("wraps local STL models with the Three.js viewer", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-workspace-"));
    tempDirs.push(workspaceDir);
    await writeFile(
      path.join(workspaceDir, "mesh.stl"),
      "solid demo\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid demo\n",
      "utf8",
    );

    const document = await createCanvasDocument(
      {
        kind: "model_3d",
        entrypoint: {
          type: "path",
          value: "mesh.stl",
        },
      },
      { stateDir, workspaceDir },
    );

    const indexHtml = await readFile(
      path.join(resolveCanvasDocumentDir(document.id, { stateDir }), "index.html"),
      "utf8",
    );
    expect(document.viewer).toBe("threejs");
    expect(document.viewerOptions).toEqual(expect.objectContaining({ format: "stl" }));
    expect(indexHtml).toContain("STLLoader");
    expect(indexHtml).toContain("OrbitControls");
  });

  it("wraps remote pdf urls in an index viewer page", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);

    const document = await createCanvasDocument(
      {
        kind: "document",
        entrypoint: {
          type: "url",
          value: "https://example.com/demo.pdf",
        },
      },
      { stateDir },
    );

    expect(document.entryUrl).toBe(`/__genesis__/canvas/documents/${document.id}/index.html`);
    const indexHtml = await readFile(
      path.join(resolveCanvasDocumentDir(document.id, { stateDir }), "index.html"),
      "utf8",
    );
    expect(indexHtml).toContain('type="application/pdf"');
    expect(indexHtml).toContain('data="https://example.com/demo.pdf"');
  });

  it("rejects traversal-style document ids in hosted canvas paths", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);

    expect(
      resolveCanvasHttpPathToLocalPath(
        "/__genesis__/canvas/documents/../collection.media/index.html",
        { stateDir },
      ),
    ).toBeNull();
  });

  it("blocks asset source traversal and absolute workspace escapes", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-workspace-"));
    tempDirs.push(workspaceDir);
    const outsideDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-outside-"));
    tempDirs.push(outsideDir);
    const outsideSecret = path.join(outsideDir, "secret.txt");
    await writeFile(outsideSecret, "secret", "utf8");

    await expect(
      createCanvasDocument(
        {
          kind: "html_bundle",
          entrypoint: { type: "html", value: "<div>ok</div>" },
          assets: [
            { logicalPath: "secret.txt", sourcePath: path.relative(workspaceDir, outsideSecret) },
          ],
        },
        { stateDir, workspaceDir },
      ),
    ).rejects.toThrow("sourcePath escapes workspace");

    await expect(
      createCanvasDocument(
        {
          kind: "html_bundle",
          entrypoint: { type: "html", value: "<div>ok</div>" },
          assets: [{ logicalPath: "secret.txt", sourcePath: outsideSecret }],
        },
        { stateDir, workspaceDir },
      ),
    ).rejects.toThrow("sourcePath escapes workspace");
  });

  it("blocks symlink asset escapes", async () => {
    if (process.platform === "win32") {
      expect(true).toBe(true);
      return;
    }
    const stateDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-"));
    tempDirs.push(stateDir);
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-workspace-"));
    tempDirs.push(workspaceDir);
    const outsideDir = await mkdtemp(path.join(tmpdir(), "genesis-canvas-documents-outside-"));
    tempDirs.push(outsideDir);
    await writeFile(path.join(outsideDir, "secret.txt"), "secret", "utf8");
    await symlink(path.join(outsideDir, "secret.txt"), path.join(workspaceDir, "linked.txt"));

    await expect(
      createCanvasDocument(
        {
          kind: "html_bundle",
          entrypoint: { type: "html", value: "<div>ok</div>" },
          assets: [{ logicalPath: "linked.txt", sourcePath: "linked.txt" }],
        },
        { stateDir, workspaceDir },
      ),
    ).rejects.toThrow("sourcePath escapes workspace");
  });
});
