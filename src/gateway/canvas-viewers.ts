export type CanvasViewerName =
  | "html"
  | "url"
  | "pdf"
  | "image"
  | "video"
  | "pptx"
  | "ppt_fallback"
  | "threejs"
  | "svg"
  | "download";

export type PresentationViewerOptions = {
  sourceHref: string;
  sourceFileName: string;
  title?: string;
  slideCount?: number;
  validationError?: string;
  convertedFrom?: string;
};

export type ModelViewerOptions = {
  sourceHref: string;
  sourceFileName: string;
  format: "gltf" | "glb" | "obj" | "stl";
  title?: string;
  mtlHref?: string;
};

export type AssetViewerOptions = {
  sourceHref: string;
  sourceFileName: string;
  title?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function commonHead(title: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #111827; --fg: #f8fafc; --muted: #94a3b8; --line: rgba(148, 163, 184, 0.32); --panel: rgba(15, 23, 42, 0.86); --accent: #38bdf8; }
  html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--fg); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  body { overflow: hidden; }
  button, a.button { appearance: none; border: 1px solid var(--line); background: rgba(255,255,255,0.08); color: var(--fg); border-radius: 8px; padding: 7px 10px; font: inherit; text-decoration: none; cursor: pointer; }
  button:hover, a.button:hover { background: rgba(255,255,255,0.14); }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  .shell { height: 100vh; display: grid; grid-template-rows: auto 1fr; min-width: 0; }
  .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px; border-bottom: 1px solid var(--line); background: var(--panel); }
  .title { min-width: 0; flex: 1 1 180px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { color: var(--muted); font-size: 12px; }
  .stage { min-width: 0; min-height: 0; overflow: hidden; position: relative; }
  .fallback { max-width: 720px; margin: 42px auto; padding: 0 18px; color: var(--fg); }
  .fallback h1 { margin: 0 0 8px; font-size: 20px; }
  .fallback p { color: var(--muted); }
  .fallback code { overflow-wrap: anywhere; }
</style>
</head>`;
}

export function genesisCanvasBridgeScript(): string {
  return `<script>
(() => {
  function normalizeRequest(input) {
    const record = input && typeof input === "object" ? input : {};
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (!message) return null;
    return {
      type: "genesis:canvas:agent-run-request",
      version: 1,
      message,
      context: record.context && typeof record.context === "object" ? record.context : null
    };
  }
  const api = globalThis.GenesisCanvas && typeof globalThis.GenesisCanvas === "object"
    ? globalThis.GenesisCanvas
    : {};
  api.requestAgentRun = (input) => {
    const payload = normalizeRequest(input);
    if (!payload) return false;
    try {
      globalThis.parent && globalThis.parent.postMessage(payload, "*");
      return true;
    } catch {
      return false;
    }
  };
  globalThis.GenesisCanvas = api;
})();
</script>`;
}

export function buildPdfWrapperHtml(sourceHref: string): string {
  const escaped = escapeHtml(sourceHref);
  return `${commonHead("PDF Preview")}
<body>
${genesisCanvasBridgeScript()}
<object data="${escaped}" type="application/pdf" style="width:100%;height:100vh;border:0;">
  <iframe src="${escaped}" style="width:100%;height:100vh;border:0;"></iframe>
  <div class="fallback">
    <h1>Unable to render PDF preview</h1>
    <p><a class="button" href="${escaped}" target="_blank" rel="noopener noreferrer">Open PDF</a></p>
  </div>
</object>
</body>
</html>`;
}

export function buildImageWrapperHtml(opts: AssetViewerOptions): string {
  const src = escapeHtml(opts.sourceHref);
  const title = opts.title || opts.sourceFileName || "Image";
  return `${commonHead(title)}
<body>
${genesisCanvasBridgeScript()}
<div class="shell">
  <div class="toolbar">
    <div class="title">${escapeHtml(title)}</div>
    <a class="button" href="${src}" target="_blank" rel="noopener noreferrer">Open</a>
    <a class="button" href="${src}" download="${escapeHtml(opts.sourceFileName)}">Download</a>
  </div>
  <div class="stage" style="display:grid;place-items:center;background:#0f172a;">
    <img src="${src}" alt="${escapeHtml(title)}" style="max-width:100%;max-height:100%;object-fit:contain;" />
  </div>
</div>
</body>
</html>`;
}

export function buildVideoWrapperHtml(opts: AssetViewerOptions): string {
  const src = escapeHtml(opts.sourceHref);
  const title = opts.title || opts.sourceFileName || "Video";
  return `${commonHead(title)}
<body>
${genesisCanvasBridgeScript()}
<div class="shell">
  <div class="toolbar">
    <div class="title">${escapeHtml(title)}</div>
    <a class="button" href="${src}" target="_blank" rel="noopener noreferrer">Open</a>
    <a class="button" href="${src}" download="${escapeHtml(opts.sourceFileName)}">Download</a>
  </div>
  <div class="stage" style="background:#000;">
    <video src="${src}" controls autoplay style="width:100%;height:100%;object-fit:contain;background:#000;"></video>
  </div>
</div>
</body>
</html>`;
}

export function buildSvgViewerHtml(opts: AssetViewerOptions): string {
  const config = {
    source: opts.sourceHref,
    fileName: opts.sourceFileName,
    title: opts.title || opts.sourceFileName || "SVG",
  };
  return `${commonHead(config.title)}
<body>
${genesisCanvasBridgeScript()}
<div class="shell">
  <div class="toolbar">
    <div class="title">${escapeHtml(config.title)}</div>
    <button id="zoom-out" type="button">Zoom out</button>
    <button id="zoom-in" type="button">Zoom in</button>
    <button id="reset" type="button">Reset</button>
    <a class="button" href="${escapeHtml(config.source)}" target="_blank" rel="noopener noreferrer">Open</a>
    <a class="button" href="${escapeHtml(config.source)}" download="${escapeHtml(config.fileName)}">Download</a>
    <span id="status" class="status"></span>
  </div>
  <div id="stage" class="stage" style="cursor:grab;background:#f8fafc;">
    <img id="image" src="${escapeHtml(config.source)}" alt="${escapeHtml(config.title)}" style="position:absolute;left:50%;top:50%;max-width:none;transform-origin:center center;user-select:none;" draggable="false" />
  </div>
</div>
<script>
(() => {
  const image = document.getElementById("image");
  const stage = document.getElementById("stage");
  const status = document.getElementById("status");
  let scale = 1;
  let x = 0;
  let y = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  function paint() {
    image.style.transform = "translate(calc(-50% + " + x + "px), calc(-50% + " + y + "px)) scale(" + scale + ")";
    status.textContent = Math.round(scale * 100) + "%";
  }
  function reset() { scale = 1; x = 0; y = 0; paint(); }
  document.getElementById("zoom-out").onclick = () => { scale = Math.max(0.1, scale / 1.25); paint(); };
  document.getElementById("zoom-in").onclick = () => { scale = Math.min(12, scale * 1.25); paint(); };
  document.getElementById("reset").onclick = reset;
  stage.addEventListener("pointerdown", (ev) => { dragging = true; lastX = ev.clientX; lastY = ev.clientY; stage.setPointerCapture(ev.pointerId); stage.style.cursor = "grabbing"; });
  stage.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    x += ev.clientX - lastX;
    y += ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    paint();
  });
  stage.addEventListener("pointerup", (ev) => { dragging = false; stage.releasePointerCapture(ev.pointerId); stage.style.cursor = "grab"; });
  stage.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    scale = Math.min(12, Math.max(0.1, scale * (ev.deltaY < 0 ? 1.1 : 0.9)));
    paint();
  }, { passive: false });
  paint();
})();
</script>
</body>
</html>`;
}

export function buildPresentationFallbackHtml(opts: {
  sourceHref: string;
  sourceFileName: string;
  title?: string;
  reason: string;
  guidance?: string;
}): string {
  const title = opts.title || opts.sourceFileName || "Presentation";
  const source = escapeHtml(opts.sourceHref);
  return `${commonHead(title)}
<body>
${genesisCanvasBridgeScript()}
<div class="fallback">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(opts.reason)}</p>
  <p>${escapeHtml(opts.guidance || "Convert this file to PPTX for a browser preview, or open the original file locally.")}</p>
  <p>
    <a class="button" href="${source}" target="_blank" rel="noopener noreferrer">Open original</a>
    <a class="button" href="${source}" download="${escapeHtml(opts.sourceFileName)}">Download</a>
  </p>
  <p class="status"><code>${escapeHtml(opts.sourceFileName)}</code></p>
</div>
</body>
</html>`;
}

export function buildPptxViewerHtml(opts: PresentationViewerOptions): string {
  const title = opts.title || opts.sourceFileName || "Presentation";
  const config = {
    source: opts.sourceHref,
    fileName: opts.sourceFileName,
    title,
    slideCount: opts.slideCount,
    validationError: opts.validationError,
    convertedFrom: opts.convertedFrom,
  };
  return `${commonHead(title)}
<body>
${genesisCanvasBridgeScript()}
<div class="shell">
  <div class="toolbar">
    <div class="title">${escapeHtml(title)}</div>
    <button id="prev" type="button" disabled>Prev</button>
    <button id="next" type="button" disabled>Next</button>
    <button id="fit" type="button">Fit</button>
    <button id="zoom-out" type="button">Zoom out</button>
    <button id="zoom-in" type="button">Zoom in</button>
    <a class="button" href="${escapeHtml(opts.sourceHref)}" target="_blank" rel="noopener noreferrer">Open</a>
    <a class="button" href="${escapeHtml(opts.sourceHref)}" download="${escapeHtml(opts.sourceFileName)}">Download</a>
    <span id="status" class="status">Loading...</span>
  </div>
  <div id="stage" class="stage" style="display:grid;place-items:center;background:#e5e7eb;overflow:auto;">
    <canvas id="slide" style="max-width:100%;height:auto;background:white;box-shadow:0 8px 32px rgba(15,23,42,0.24);"></canvas>
    <div id="fallback" class="fallback" hidden></div>
  </div>
</div>
<script src="/__genesis__/canvas/viewers/vendor/jszip/dist/jszip.min.js"></script>
<script src="/__genesis__/canvas/viewers/vendor/chart.js/dist/chart.umd.js"></script>
<script src="/__genesis__/canvas/viewers/vendor/pptxviewjs/dist/PptxViewJS.min.js"></script>
<script>
(() => {
  const config = ${jsonForScript(config)};
  const canvas = document.getElementById("slide");
  const fallback = document.getElementById("fallback");
  const status = document.getElementById("status");
  const prev = document.getElementById("prev");
  const next = document.getElementById("next");
  let viewer = null;
  let current = 0;
  let count = 0;
  let scale = 1;
  function showFallback(message) {
    canvas.hidden = true;
    fallback.hidden = false;
    fallback.innerHTML = "";
    const h = document.createElement("h1");
    h.textContent = config.title;
    const p = document.createElement("p");
    p.textContent = message;
    const open = document.createElement("a");
    open.className = "button";
    open.href = config.source;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "Open original";
    fallback.append(h, p, open);
    status.textContent = "Preview unavailable";
  }
  function syncStatus() {
    status.textContent = count > 0 ? "Slide " + (current + 1) + " of " + count + " at " + Math.round(scale * 100) + "%" : "No slides";
    prev.disabled = current <= 0;
    next.disabled = current >= count - 1;
  }
  async function render() {
    if (!viewer) return;
    if (typeof viewer.renderSlide === "function") {
      await viewer.renderSlide(current, canvas, { scale });
    } else if (typeof viewer.goToSlide === "function") {
      await viewer.goToSlide(current, canvas);
    } else {
      await viewer.render(canvas, { slideIndex: current, scale });
    }
    syncStatus();
  }
  async function boot() {
    if (config.validationError) {
      showFallback(config.validationError);
      return;
    }
    const api = globalThis.PptxViewJS;
    if (!api || typeof api.PPTXViewer !== "function") {
      showFallback("The bundled PPTX renderer did not load.");
      return;
    }
    viewer = new api.PPTXViewer({ canvas, backgroundColor: "#ffffff" });
    await viewer.loadFromUrl(config.source);
    count = Number(viewer.getSlideCount && viewer.getSlideCount()) || Number(config.slideCount) || 0;
    if (count <= 0) {
      showFallback("No previewable slides were found in this PPTX file.");
      return;
    }
    await render();
  }
  prev.onclick = () => { if (current > 0) { current -= 1; void render(); } };
  next.onclick = () => { if (current < count - 1) { current += 1; void render(); } };
  document.getElementById("fit").onclick = () => { scale = 1; void render(); };
  document.getElementById("zoom-out").onclick = () => { scale = Math.max(0.25, scale / 1.2); void render(); };
  document.getElementById("zoom-in").onclick = () => { scale = Math.min(3, scale * 1.2); void render(); };
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowLeft") prev.click();
    if (ev.key === "ArrowRight") next.click();
  });
  boot().catch((err) => showFallback(err && err.message ? err.message : String(err)));
})();
</script>
</body>
</html>`;
}

export function buildModelViewerHtml(opts: ModelViewerOptions): string {
  const title = opts.title || opts.sourceFileName || "3D Model";
  const config = {
    source: opts.sourceHref,
    fileName: opts.sourceFileName,
    title,
    format: opts.format,
    mtl: opts.mtlHref,
  };
  return `${commonHead(title)}
<body>
${genesisCanvasBridgeScript()}
<div class="shell">
  <div class="toolbar">
    <div class="title">${escapeHtml(title)}</div>
    <button id="reset" type="button">Reset camera</button>
    <button id="light" type="button">Lighting</button>
    <button id="wire" type="button">Wireframe</button>
    <a class="button" href="${escapeHtml(opts.sourceHref)}" target="_blank" rel="noopener noreferrer">Open</a>
    <a class="button" href="${escapeHtml(opts.sourceHref)}" download="${escapeHtml(opts.sourceFileName)}">Download</a>
    <span id="status" class="status">Loading...</span>
  </div>
  <div id="stage" class="stage"></div>
</div>
<script type="importmap">
{
  "imports": {
    "three": "/__genesis__/canvas/viewers/vendor/three/build/three.module.js",
    "three/addons/": "/__genesis__/canvas/viewers/vendor/three/examples/jsm/"
  }
}
</script>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

const config = ${jsonForScript(config)};
const stage = document.getElementById("stage");
const status = document.getElementById("status");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111827);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
stage.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.3);
const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(4, 8, 6);
scene.add(hemi, key);
let model = null;
let wireframe = false;
function pathDir(value) {
  const i = value.lastIndexOf("/");
  return i >= 0 ? value.slice(0, i + 1) : "";
}
function pathBase(value) {
  const i = value.lastIndexOf("/");
  return i >= 0 ? value.slice(i + 1) : value;
}
function setStatus(value) { status.textContent = value; }
function resize() {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
function fitObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    camera.position.set(2, 2, 2);
    controls.target.set(0, 0, 0);
    return;
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  object.position.sub(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const distance = maxDim / (2 * Math.tan((Math.PI * camera.fov) / 360));
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 100;
  camera.position.set(distance * 0.9, distance * 0.7, distance * 1.4);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}
function setWireframe(enabled) {
  wireframe = enabled;
  if (!model) return;
  model.traverse((child) => {
    const material = child.material;
    if (Array.isArray(material)) {
      material.forEach((m) => { if (m && "wireframe" in m) m.wireframe = wireframe; });
    } else if (material && "wireframe" in material) {
      material.wireframe = wireframe;
    }
  });
}
async function loadModel() {
  if (config.format === "gltf" || config.format === "glb") {
    const gltf = await new GLTFLoader().loadAsync(config.source);
    return gltf.scene || gltf.scenes?.[0];
  }
  if (config.format === "obj") {
    const loader = new OBJLoader();
    if (config.mtl) {
      const materials = await new MTLLoader().setPath(pathDir(config.mtl)).loadAsync(pathBase(config.mtl));
      materials.preload();
      loader.setMaterials(materials);
    }
    return await loader.loadAsync(config.source);
  }
  const geometry = await new STLLoader().loadAsync(config.source);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x93c5fd, roughness: 0.55, metalness: 0.05 });
  return new THREE.Mesh(geometry, material);
}
function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
document.getElementById("reset").onclick = () => { if (model) fitObject(model); };
document.getElementById("light").onclick = () => {
  hemi.visible = !hemi.visible;
  key.visible = hemi.visible;
};
document.getElementById("wire").onclick = () => setWireframe(!wireframe);
new ResizeObserver(resize).observe(stage);
resize();
animate();
loadModel().then((object) => {
  if (!object) throw new Error("No model scene was returned by the loader.");
  model = object;
  scene.add(model);
  fitObject(model);
  setStatus(config.fileName);
}).catch((err) => {
  setStatus("Preview unavailable");
  const box = document.createElement("div");
  box.className = "fallback";
  box.innerHTML = "<h1>Unable to render 3D preview</h1><p></p>";
  box.querySelector("p").textContent = err && err.message ? err.message : String(err);
  stage.appendChild(box);
});
</script>
</body>
</html>`;
}
