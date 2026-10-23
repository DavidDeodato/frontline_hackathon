import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Static service room, rendered only on resize or focus. No business inference. */
export function buildRoom(host, { onProject, onFailure }) {
  const started = performance.now();
  let disposed = false, frame = null;
  const geometries = new Set(), materials = new Set(), samples = [], materialCache = new Map();
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .92;
  host.appendChild(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-7, 7, 6, -6, .1, 80);
  camera.position.set(11, 10.8, 13); camera.lookAt(0, .8, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x55585b, 1.25));
  const light = new THREE.DirectionalLight(0xffffff, 2.4);
  light.position.set(1, 11, 7); light.castShadow = true; light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: .1, far: 35 });
  light.shadow.bias = -.00025; light.shadow.normalBias = .025; light.shadow.radius = 4; light.shadow.blurSamples = 8; scene.add(light);
  const fill = new THREE.DirectionalLight(0xdfe9ec, .55); fill.position.set(6, 4, -2); scene.add(fill);
  const geo = geometry => { geometries.add(geometry); return geometry; };
  const cube = geo(new RoundedBoxGeometry(1, 1, 1, 2, .018)), sphere = geo(new THREE.SphereGeometry(1, 32, 20)), capsule = geo(new THREE.CapsuleGeometry(.29, .56, 10, 24));
  const mat = (color, extra = {}) => {
    const key = color + JSON.stringify(extra);
    if (!materialCache.has(key)) {
      const shade = new THREE.Color(color);
      if (Math.max(shade.r, shade.g, shade.b) - Math.min(shade.r, shade.g, shade.b) < .10) {
        const neutral = (shade.r + shade.g + shade.b) / 3; shade.setRGB(neutral, neutral, neutral);
      }
      const m = new THREE.MeshStandardMaterial({ color: shade, roughness: .82, metalness: .02, ...extra }); materialCache.set(key, m); materials.add(m);
    }
    return materialCache.get(key);
  };
  const add = (geometry, material, x, y, z) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); return mesh; };
  const box = (x, y, z, w, h, d, color, extra = {}) => { const mesh = add(cube, typeof color === 'string' ? mat(color, extra) : color, x, y, z); mesh.scale.set(w, h, d); return mesh; };

  // Two cutaway walls and a plain floor, as in the approved scene.
  box(0, -.23, 0, 8.35, .42, 7.75, '#a4a7a5'); box(0, -.04, 0, 8.12, .07, 7.52, '#bfc1be');
  box(-4, 1.4, -.01, .18, 2.85, 7.57, '#c3c5c2'); box(.03, 1.4, -3.72, 8.13, 2.85, .18, '#c5c7c4');
  box(-3.89, .10, .05, .045, .18, 7.4, '#9fa39f'); box(.02, .10, -3.61, 7.98, .18, .045, '#9fa39f');

  // Continuous left-wall cabinet, upper shelf, tall corner cupboard.
  box(-3.45, .59, .53, 1.02, 1.17, 5.56, '#959b98'); box(-3.4, 1.20, .53, 1.15, .12, 5.69, '#c9ccc7');
  for (const z of [-1.5, -.14, 1.22, 2.58]) { box(-2.925, .60, z, .025, 1.05, 1.28, '#9ca19e'); box(-2.902, .68, z + .45, .035, .30, .035, '#555e5c'); }
  box(-3.57, 1.96, .48, .86, .10, 5.55, '#caccc7');
  for (const z of [-1.25, 2.35]) box(-3.66, 1.78, z, .32, .28, .055, '#9fa4a0');
  box(-3.45, 1.38, -2.77, 1.01, 2.73, 1.18, '#717a78'); box(-2.93, 1.38, -2.77, .03, 2.65, 1.11, '#78827f'); box(-2.9, 1.38, -2.34, .035, .43, .04, '#3e4847');
  const storageBox = (x, y, z, w, h, d, color) => { box(x, y, z, w, h, d, color); box(x, y + h / 2, z, w + .025, .038, d + .025, color); box(x + w / 2 + .012, y + .04, z, .025, .035, d * .34, '#4a5251'); };
  storageBox(-3.37, 1.44, 2.15, .72, .36, .89, '#6c7572'); storageBox(-3.36, 1.43, .55, .69, .32, 1.16, '#5a625f');
  storageBox(-3.37, 1.42, -1.2, .72, .30, 1.02, '#686e6a'); storageBox(-3.56, 2.13, 2.33, .42, .27, .56, '#636d69'); storageBox(-3.55, 2.14, .2, .54, .30, .85, '#b5b9b3');

  // Counter runs perpendicular to the right wall.
  box(.48, .62, .45, 1.03, 1.22, 5.57, '#c5c8c2'); box(.48, 1.255, .45, 1.14, .105, 5.70, '#dedfd8'); box(1.008, .72, .45, .012, 1.02, 5.44, '#adb5b0');
  const cyan = mat('#32eafa', { emissive: '#13cadd', emissiveIntensity: .8, roughness: .35, toneMapped: false });
  box(1.025, .96, .44, .025, .046, 4.40, cyan);
  box(1.018, .96, .44, .021, .14, 4.43, mat('#39dce6', { transparent: true, opacity: .14, emissive: '#0bdcf1', emissiveIntensity: .9, depthWrite: false }));
  box(.48, 1.36, 2.30, .60, .15, .65, '#626a67'); box(.48, 1.45, 2.30, .60, .025, .65, '#777f7a');
  const terminal = box(.40, 1.52, -1.06, .10, .37, .77, '#525d5c'); terminal.rotation.z = -.20;
  box(.44, 1.33, -1.06, .37, .045, .72, '#666e6a'); box(.43, 1.41, -2.15, .49, .20, .48, '#626c66');

  // Work order is geometry; all useful contents stay in the HTML document.
  const paper = box(.59, 1.321, .65, .72, .012, .70, '#f4f2e8'); paper.rotation.y = -.08;
  for (let n = 0; n < 5; n++) box(.60, 1.332, .40 + n * .095, n === 0 ? .41 : .50, .007, .017, n === 0 ? '#626e70' : '#9ca8a5');
  box(.85, 1.337, .92, .08, .008, .06, '#be7955'); box(.24, 1.342, .66, .026, .025, .42, '#8e8b80');

  // Policy and calendar on the right wall, matching the reference anchors.
  box(-1.27, 1.93, -3.59, .99, 1.27, .095, '#515f5f'); box(-1.27, 1.93, -3.53, .87, 1.13, .025, '#d5d8d0');
  for (let n = 0; n < 7; n++) box(-1.30, 2.31 - n * .125, -3.509, n === 0 ? .48 : .60, .021, .012, '#828e8d');
  const calendarX = 2.10;
  box(calendarX, 1.71, -3.58, 1.32, 1.11, .08, '#596561'); box(calendarX, 1.68, -3.53, 1.23, .99, .025, '#dadad1'); box(calendarX, 2.18, -3.505, 1.28, .10, .025, '#787f78');
  for (let col = 0; col <= 5; col++) box(calendarX - .55 + col * .22, 1.66, -3.509, .009, .76, .012, '#a5aba3');
  for (let row = 0; row <= 4; row++) box(calendarX, 1.28 + row * .19, -3.506, 1.13, .009, .012, '#a5aba3');
  box(calendarX + .22, 1.75, -3.495, .20, .17, .015, '#d48b5f');
  box(2.38, .48, -3.1, 2.15, .10, .83, '#b5bab1'); box(2.38, .08, -3.1, 2.15, .10, .83, '#a0a99e');
  for (const x of [1.35, 2.37, 3.41]) box(x, .28, -3.10, .075, .40, .83, '#a4afa3');
  storageBox(1.90, .28, -3.11, .77, .27, .56, '#657064'); storageBox(2.94, .28, -3.11, .71, .27, .56, '#70796d');

  const character = (x, z, color) => { const m = mat(color, { roughness: .65 }); const body = add(capsule, m, x, .64, z); body.scale.set(1.2, 1.1, 1.2); const head = add(sphere, m, x, 1.55, z); head.scale.setScalar(.36); };
  character(-.90, .30, '#63676b'); character(2.14, .91, '#ad633f');

  const focusMaterials = new Map();
  const outline = (id, x, y, z, w, h, d, wall) => {
    const m = new THREE.MeshBasicMaterial({ color: '#32eafa', toneMapped: false, transparent: true, opacity: 0, depthWrite: false }); materials.add(m); focusMaterials.set(id, m);
    if (wall) { for (const side of [-1, 1]) box(x + side * w / 2, y, z, .025, h, .025, m); for (const side of [-1, 1]) box(x, y + side * h / 2, z, w, .025, .025, m); }
    else { for (const side of [-1, 1]) box(x + side * w / 2, y, z, .016, .016, d, m); for (const side of [-1, 1]) box(x, y, z + side * d / 2, w, .016, .016, m); }
  };
  outline('OBJ-POLITICA', -1.27, 1.93, -3.48, 1.04, 1.32, 0, true); outline('OBJ-CALENDARIO', calendarX, 1.71, -3.48, 1.36, 1.15, 0, true); outline('OBJ-ORDEM', .59, 1.345, .65, .77, 0, .75, false);
  const anchors = { 'OBJ-ORDEM': new THREE.Vector3(.71, 1.36, .63), 'OBJ-POLITICA': new THREE.Vector3(-1.21, 2.48, -3.47), 'OBJ-CALENDARIO': new THREE.Vector3(2.58, 2.17, -3.47) };
  let width = 0, height = 0, renderCount = 0, firstFrameMs = null;
  const metrics = () => {
    const sorted = samples.slice().sort((a, b) => a - b), percentile = p => sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2) : null;
    return { mode: 'on-demand', renderCount, measuredFrames: sorted.length, medianRenderMs: percentile(.5), p95RenderMs: percentile(.95), firstFrameMs, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, pixelRatio: renderer.getPixelRatio(), width, height, idleAnimation: false };
  };
  function render() {
    frame = null; if (disposed || !width || !height || document.hidden) return;
    const before = performance.now(); renderer.render(scene, camera); samples.push(performance.now() - before); if (samples.length > 120) samples.shift(); renderCount++;
    if (firstFrameMs === null) firstFrameMs = +(performance.now() - started).toFixed(2);
    const points = {};
    for (const [id, point] of Object.entries(anchors)) { const v = point.clone().project(camera); points[id] = { x: (v.x * .5 + .5) * width, y: (-v.y * .5 + .5) * height }; }
    onProject?.(points); host.dataset.sceneMetrics = JSON.stringify(metrics());
  }
  const requestRender = () => { if (!disposed && frame === null) frame = requestAnimationFrame(render); };
  function resize() {
    width = host.clientWidth; height = host.clientHeight; if (!width || !height) return;
    renderer.setSize(width, height, false); const aspect = width / height, halfHeight = Math.max(4.75, 6.10 / aspect);
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix(); requestRender();
  }
  const observer = new ResizeObserver(resize); observer.observe(host);
  const visibility = () => { if (!document.hidden) requestRender(); };
  const lost = event => { event.preventDefault(); onFailure?.(); };
  document.addEventListener('visibilitychange', visibility); renderer.domElement.addEventListener('webglcontextlost', lost); resize();
  return {
    setFocus(id) { for (const [key, m] of focusMaterials) m.opacity = key === id ? 1 : 0; requestRender(); }, metrics,
    dispose() { if (disposed) return; disposed = true; cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('visibilitychange', visibility); renderer.domElement.removeEventListener('webglcontextlost', lost); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); },
  };
}
