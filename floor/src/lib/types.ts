// Floor Survey — domain types

export type Mode = "setup" | "field" | "review" | "topo" | "export";

export interface ProjectMeta {
  id: string;
  name: string;
  address: string;
  client: string;
  inspector: string;
  inspectionDate: string; // ISO date
  notes: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  // Timestamp of the last successful export. Used to warn users when local
  // changes have not been backed up to a .json bundle.
  lastExportedAt?: number;
  // Set when this project was created via duplicateProject(). Presence of
  // this field unlocks destructive "swap plan image" tools that we never
  // want on original surveys.
  parentProjectId?: string;
  // Custom flooring surface names typed via the "Other" option in the
  // transition picker. Accumulates for the life of the project.
  customSurfaces?: string[];
}


export interface PlanTransform {
  tx: number;       // translate in image-coord pixels
  ty: number;
  scale: number;    // uniform, around image center
  rotation: number; // radians, around image center
}

export interface Floor {
  id: string;
  projectId: string;
  name: string; // "1st Floor", "Basement", etc.
  order: number;
  // Plan image
  planDataUrl?: string; // stored as data URL for offline-first
  planWidth?: number;
  planHeight?: number;
  // Legacy single outer boundary. Always mirrors areas[0].polygon.
  boundary: Array<{ x: number; y: number }>;
  // Survey areas — each draws its own contour surface and its own High/Low/Δ.
  // Missing on older floors; getAreas() falls back to `boundary` as "Area 1".
  areas?: TopoArea[];
  // Scale calibration
  scale?: {
    // two points and the known real-world length in inches between them
    a: { x: number; y: number };
    b: { x: number; y: number };
    lengthInches: number;
  };
  createdAt: number;
  updatedAt: number;
  // Topo presentation: user-nudged offsets for the High/Low pins.
  // undefined = default position centered above the point.
  highPinDx?: number;
  highPinDy?: number;
  lowPinDx?: number;
  lowPinDy?: number;
  // Room notes — orange pins visible only on the field/data entry screen.
  notes?: NotePin[];
  // Flooring transitions — per-doorway anchor records. Each transition creates
  // one anchor SurveyPoint (isTransitionAnchor + transitionId) at (x, y) and
  // may be referenced by downstream points (transitionId set, not anchor).
  transitions?: Transition[];
  // Per-surface-pair averaged correction overrides. Key = `${surfaceA}→${surfaceB}`.
  // When set, every transition in that group resolves to this delta instead of
  // its own measured (readingA − readingB). Cleared by "Revert" in the sheet.
  transitionGroupAverages?: Record<string, number>;
  // Excluded areas — polygons inside the outer boundary that the topo engine
  // treats as holes. Readings inside still plot and appear in Review; they
  // just don't influence the contour surface or the stats.
  exclusions?: Exclusion[];
  // Optional visual transform applied to the plan image only. Points stay
  // in the same coordinate space; this shifts/scales/rotates the raster
  // beneath them so a replaced photo/screenshot can be re-aligned to
  // existing points. Only mutated inside Align mode on a duplicated project.
  planTransform?: PlanTransform;

}

export interface TopoArea {
  id: string;
  name: string;                             // "Area 1", "Kitchen", …
  polygon: Array<{ x: number; y: number }>; // image coords
  createdAt: number;
  // Offset (image coords) of this area's H/L/Δ stats pill from the area
  // centroid. Undefined = pill sits at the centroid.
  pillDx?: number;
  pillDy?: number;
}

export interface Exclusion {
  id: string;
  label?: string;                        // "Garage", "Sunken LR"
  polygon: Array<{ x: number; y: number }>; // image coords
  createdAt: number;
}

export interface NotePin {
  id: string;
  x: number; // image coords
  y: number;
  text: string;
}

export interface Transition {
  id: string;
  x: number; // image coords of the anchor
  y: number;
  surfaceA: string; // reference side (anchor is captured here)
  surfaceB: string; // other side (downstream points live here)
  readingA: number; // ALWAYS base-frame (already includes any parent-chain delta)
  readingB: number; // raw reading on surfaceB at the doorway
  createdAt: number;
  // Chaining: when this transition was measured while an existing transition
  // was active, parentId links to that parent. readingA is stored base-frame,
  // so delta math stays flat (no recursive resolution at read time).
  parentId?: string;
  // The raw reading typed on the parent surface (before parent delta added).
  // Kept for display and for re-deriving readingA if the parent is edited.
  readingARawOnParent?: number;
  // Manual override of the correction delta. When set, transitionDelta()
  // returns this value instead of (readingA − readingB). Editing either
  // reading in the detail dialog clears the override.
  manualDeltaOverride?: number;
  // Opt-in flag: when true, transitionDelta() uses the surface-pair group
  // average (floor.transitionGroupAverages[key]) instead of this doorway's
  // own measured (readingA − readingB). Default (undefined/false) = use this
  // doorway's own measurement.
  useGroupAverage?: boolean;
}


export interface SurveyPoint {
  id: string;
  floorId: string;
  index: number; // display number, 1..n
  x: number; // image coords
  y: number;
  value: number; // raw elevation reading in inches (BP default 9.0)
  isBasePoint?: boolean;
  label?: string; // BP1, BP2, etc.
  notes?: string;
  createdAt: number;
  // Topo presentation: user-nudged label offset from the dot.
  // undefined = use default offset (+8, +6).
  labelDx?: number;
  labelDy?: number;
  // Transition tagging.
  // - Anchor point: isTransitionAnchor = true AND transitionId set. `value`
  //   stores readingA (reference side); no offset applied.
  // - Downstream point on the "other" surface: transitionId set (no anchor
  //   flag). `value` is the raw reading; corrected value = value + delta,
  //   where delta = readingA − readingB.
  transitionId?: string;
  isTransitionAnchor?: boolean;
}


export interface RenderSettings {
  mode: "contour-fill" | "contour-cells" | "contour-bw" | "points-only";
  interval: number; // legacy alias for contourStep
  firstContour: number | null;
  contourStep: number;
  contourCount: number | null; // null = auto (cover full data range at contourStep)
  minClamp: number | null;
  maxClamp: number | null;
  decimalPlaces: number;
  palette:
    | "brown"
    | "rainbow"
    | "blue-red"
    | "red-yellow-green"
    | "gray"
    | "ocean"
    | "sunset"
    | "forest"
    | "viridis"
    | "topographic"
    | "gray-amber"
    | "nm-sunset"
    | "mountain";
  reversePalette: boolean;
  lineThickness: number;
  showPlan: boolean;
  planOpacity: number;
  showContours: boolean;
  contourOpacity: number;
  showLabels: boolean;
  showPoints: boolean;
  pointsOpacity: number;
  pointLabelBackground: "white" | "transparent" | "plain";
  pointLabelFontSize: number;
  pointLabelColor: string;
  pointLabelWeight: "normal" | "bold";
  highLowPinSize: number;
  showLegend: boolean;
  legendX: number;
  legendY: number;
  legendScale: number;
  showHighLow: boolean;
  declutterLabels: boolean;
  exaggeration: number;
}

export const defaultRenderSettings: RenderSettings = {
  mode: "contour-fill",
  interval: 0.2,
  firstContour: null,
  contourStep: 0.2,
  contourCount: null,
  minClamp: null,
  maxClamp: null,
  decimalPlaces: 2,
  palette: "brown",
  reversePalette: false,
  lineThickness: 1.2,
  showPlan: true,
  planOpacity: 0.62,
  showContours: true,
  contourOpacity: 1,
  showLabels: true,
  showPoints: true,
  pointsOpacity: 1,
  pointLabelBackground: "white",
  pointLabelFontSize: 11,
  pointLabelColor: "#17130e",
  pointLabelWeight: "bold",
  highLowPinSize: 11,
  showLegend: true,
  legendX: 24,
  legendY: 24,
  legendScale: 1,
  showHighLow: true,
  declutterLabels: true,
  exaggeration: 1,
};
