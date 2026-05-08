---
summary: "Rich output shortcode protocol for embeds, media, audio hints, and replies"
read_when:
  - Changing assistant output rendering in the Control UI
  - Debugging `[embed ...]`, `MEDIA:`, reply, or audio presentation directives
title: "Rich output protocol"
---

Assistant output can carry a small set of delivery/render directives:

- `MEDIA:` for attachment delivery
- `[[audio_as_voice]]` for audio presentation hints
- `[[reply_to_current]]` / `[[reply_to:<id>]]` for reply metadata
- `[embed ...]` for Control UI rich rendering

These directives are separate. `MEDIA:` and reply/voice tags remain delivery metadata; `[embed ...]` is the web-only rich render path.

When block streaming is enabled, `MEDIA:` remains single-delivery metadata for a
turn. If the same media URL is sent in a streamed block and repeated in the final
assistant payload, Genesis delivers the attachment once and strips the duplicate
from the final payload.

## `[embed ...]`

`[embed ...]` is the only agent-facing rich render syntax for the Control UI.

Self-closing example:

```text
[embed ref="cv_123" title="Status" /]
```

Rules:

- `[view ...]` is no longer valid for new output.
- Embed shortcodes render in the assistant message surface only.
- Only URL-backed embeds are rendered. Use `ref="..."` or `url="..."`.
- Agents should use the `canvas` tool with `action: "create"` to create hosted embed documents before replying with `[embed ref="..."]`.
- Agents can use `canvas` with `action: "update"` and the same `id` to publish a new revision while keeping the embed URL stable.
- Block-form inline HTML embed shortcodes are not rendered.
- The web UI strips the shortcode from visible text and renders the embed inline.
- `MEDIA:` is not an embed alias and should not be used for rich embed rendering.

## Stored rendering shape

The normalized/stored assistant content block is a structured `canvas` item:

```json
{
  "type": "canvas",
  "preview": {
    "kind": "canvas",
    "surface": "assistant_message",
    "render": "url",
    "viewId": "cv_123",
    "url": "/__genesis__/canvas/documents/cv_123/index.html",
    "title": "Status",
    "preferredHeight": 320
  }
}
```

Stored/rendered rich blocks use this `canvas` shape directly. `present_view` is not recognized.

## Hosted Canvas Assets

Hosted Canvas documents keep stable entry URLs like
`/__genesis__/canvas/documents/<id>/index.html`. Updates are stored under
`documents/<id>/revisions/<n>/` and the latest revision is republished into the
stable document root so existing embeds can live-reload.

Canvas v1 is view/import first. Supported rich asset kinds are:

- `presentation_asset`: `.pptx` browser preview; `.ppt` accepted with optional
  local `soffice`/LibreOffice conversion or a safe fallback.
- `model_3d`: `.glb`, `.gltf`, `.obj`, and `.stl` via a Three.js viewer.
- `vector_image`: `.svg` through an `<img>` wrapper instead of inline SVG.

Manifests include `revision`, `sourceMime`, `sourceFileName`, `viewer`,
`viewerOptions`, and copied asset metadata.

## Related

- [RPC adapters](/reference/rpc)
- [Typebox](/concepts/typebox)
