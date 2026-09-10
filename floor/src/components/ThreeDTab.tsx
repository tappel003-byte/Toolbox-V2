import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { X, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { buildGrid, clampValue, TOPO_GRID_TARGET_COLS } from "@/lib/topo";
import { computeExclusionMap } from "@/lib/exclusions";
import { paletteColor } from "@/components/tabs/TopoTab";
import type { Floor, RenderSettings, SurveyPoint } from "@/lib/types";

interface Props {
  floor: Floor;
  points: SurveyPoint[];
  settings: RenderSettings;
  onClose: () => void;
}

/**
 * Standalone 3D visualization: rotatable colored elevation mesh built from
 * the same TPS grid used by Topo. Free-orbit camera, height exaggeration
 * slider, optional survey-point spheres, PNG screenshot export. View state
 * is session-only; nothing persists to the Floor.
 */
export function ThreeDTab({ floor, points, settings, onClose }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const pointsGroupRef = useRef<THREE.Group | null>(null);
  const baseZRef = useRef<Float32Array | null>(null);
  const zScaleRef = useRef<number>(1);

  const [exaggeration, setExaggeration] = useState<number>(3);
  const [showPoints, setShowPoints] = useState<boolean>(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const palette = settings.palette;
  const reverse = settings.reversePalette;

  const activePoints = useMemo(() => {
    const exMap = computeExclusionMap(points, floor.exclusions ?? []);
    return points.filter((p) => !exMap.has(p.id));
  }, [points, floor.exclusions]);

  const grid = useMemo(() => {
    if (activePoints.length < 3 || floor.boundary.length < 3) return null;
    return buildGrid(
      activePoints,
      floor.boundary,
      TOPO_GRID_TARGET_COLS,
      (floor.exclusions ?? []).map((e) => e.polygon),
    );
  }, [activePoints, floor.boundary, floor.exclusions]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0b0b0b, 1);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    camera.position.set(0, -1.2, 0.9);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(1, 1, 2);
    scene.add(key);

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      scene.clear();
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
      meshRef.current = null;
    }
    if (pointsGroupRef.current) {
      scene.remove(pointsGroupRef.current);
      pointsGroupRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (m.material as THREE.Material).dispose();
      });
      pointsGroupRef.current = null;
    }

    if (!grid) {
      setReady(false);
      setError(activePoints.length < 3 ? "Need at least 3 survey points." : "Boundary is missing.");
      return;
    }
    setError(null);

    const { width: cols, height: rows, values, mask, minValue, maxValue, x0, y0, step } = grid;

    const planW = cols * step;
    const planH = rows * step;
    const planScale = 1 / Math.max(planW, planH);
    const zRange = Math.max(0.001, maxValue - minValue);
    const baseZScale = ((Math.min(planW, planH) * planScale) * 0.15) / zRange;
    zScaleRef.current = baseZScale;

    const vertIndex = new Int32Array(cols * rows).fill(-1);
    const positions: number[] = [];
    const colors: number[] = [];
    const baseZ: number[] = [];
    const cx = x0 + planW / 2;
    const cy = y0 + planH / 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (!mask[idx] || !isFinite(values[idx])) continue;
        const px = x0 + c * step;
        const py = y0 + r * step;
        const v = values[idx];
        const wx = (px - cx) * planScale;
        const wy = -(py - cy) * planScale;
        const wz = (v - minValue) * baseZScale * exaggeration;
        vertIndex[idx] = positions.length / 3;
        positions.push(wx, wy, wz);
        baseZ.push((v - minValue) * baseZScale);

        const t = clampValue(v, minValue, maxValue);
        const rgb = paletteColor(t, palette, reverse);
        const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb);
        if (m) {
          colors.push(+m[1] / 255, +m[2] / 255, +m[3] / 255);
        } else {
          colors.push(1, 1, 1);
        }
      }
    }

    const indices: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = vertIndex[r * cols + c];
        const b = vertIndex[r * cols + (c + 1)];
        const d = vertIndex[(r + 1) * cols + c];
        const e = vertIndex[(r + 1) * cols + (c + 1)];
        if (a < 0 || b < 0 || d < 0 || e < 0) continue;
        indices.push(a, d, b);
        indices.push(b, d, e);
      }
    }

    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(positions);
    geom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    baseZRef.current = new Float32Array(baseZ);

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide,
      flatShading: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    scene.add(mesh);
    meshRef.current = mesh;

    controls.target.set(0, 0, 0);
    camera.position.set(0.6, -0.9, 0.7);
    controls.update();

    setReady(true);

    const group = new THREE.Group();
    const sphereGeom = new THREE.SphereGeometry(planScale * step * 1.5, 12, 10);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.5,
      metalness: 0.2,
    });
    for (const p of activePoints) {
      const s = new THREE.Mesh(sphereGeom, sphereMat);
      const wx = (p.x - cx) * planScale;
      const wy = -(p.y - cy) * planScale;
      const wz = (p.value - minValue) * baseZScale * exaggeration + planScale * step * 1.5;
      s.position.set(wx, wy, wz);
      group.add(s);
    }
    group.visible = showPoints;
    scene.add(group);
    pointsGroupRef.current = group;
  }, [grid, palette, reverse, activePoints]);

  useEffect(() => {
    const mesh = meshRef.current;
    const baseZ = baseZRef.current;
    if (!mesh || !baseZ) return;
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < baseZ.length; i++) {
      pos.setZ(i, baseZ[i] * exaggeration);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();

    const group = pointsGroupRef.current;
    if (group && grid) {
      const { minValue, step, x0, y0, width, height } = grid;
      const planW = width * step;
      const planH = height * step;
      const planScale = 1 / Math.max(planW, planH);
      const cx = x0 + planW / 2;
      const cy = y0 + planH / 2;
      const baseZScale = zScaleRef.current;
      const bump = planScale * step * 1.5;
      let i = 0;
      for (const p of activePoints) {
        const s = group.children[i++] as THREE.Mesh | undefined;
        if (!s) break;
        const wx = (p.x - cx) * planScale;
        const wy = -(p.y - cy) * planScale;
        const wz = (p.value - minValue) * baseZScale * exaggeration + bump;
        s.position.set(wx, wy, wz);
      }
    }
  }, [exaggeration, grid, activePoints]);

  useEffect(() => {
    if (pointsGroupRef.current) pointsGroupRef.current.visible = showPoints;
  }, [showPoints]);

  const handleExport = () => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${floor.name || "floor"}-3d.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-neutral-950 text-white flex flex-col">
      <div className="flex items-center gap-2 px-3 h-11 border-b border-white/10 bg-black/40 backdrop-blur">
        <button
          onClick={onClose}
          className="inline-flex items-center justify-center h-8 w-8 rounded hover:bg-white/10"
          aria-label="Close 3D view"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="text-sm font-medium truncate">{floor.name} · 3D</div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleExport}
            disabled={!ready}
            className="h-8"
          >
            <Camera className="h-4 w-4 mr-1.5" />
            Export image
          </Button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={mountRef} className="absolute inset-0" />

        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building surface…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70 text-center px-6">
            {error}
          </div>
        )}

        <div className="absolute top-3 right-3 w-60 rounded-md bg-black/70 backdrop-blur border border-white/10 p-3 text-xs space-y-3">
          <div>
            <Label className="text-white/80 text-xs">
              Height exaggeration · {exaggeration.toFixed(1)}×
            </Label>
            <Slider
              min={0.5}
              max={20}
              step={0.1}
              value={[exaggeration]}
              onValueChange={([v]) => setExaggeration(v)}
              className="mt-2"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-white/80 text-xs">Show survey points</Label>
            <Switch checked={showPoints} onCheckedChange={setShowPoints} />
          </div>
          <div className="text-[10px] text-white/50 leading-snug">
            Drag to orbit · pinch / scroll to zoom · two-finger drag to pan
          </div>
        </div>
      </div>
    </div>
  );
}

export default ThreeDTab;
