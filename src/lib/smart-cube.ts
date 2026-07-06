import * as THREE from "three";
import { COLOR_HEX, DEFAULT_ORIENTATION, getFaceColors, type CubeColor, type CubeOrientation } from "@/lib/cube-appearance";
import { expandMoveNotation } from "@/lib/algorithms";

export type CubeFace = "U" | "D" | "L" | "R" | "F" | "B";
export type CubeSlice = "M" | "E" | "S";
export type CubeMoveLayer = CubeFace | CubeSlice;

export type CubeQuaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type CubeDisplayState = {
  cameraDistance: number;
  cameraLatitude: number;
  cameraLongitude: number;
};

export type CubeCameraViewportInsets = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export type CubeSceneOffset = {
  x?: number;
  y?: number;
  z?: number;
};

export const DEFAULT_CUBE_DISPLAY_STATE: CubeDisplayState = {
  cameraDistance: 7,
  cameraLatitude: 35,
  cameraLongitude: 45,
};

export type SmartCubeApi = {
  applyMove(layer: CubeMoveLayer, dir?: 1 | -1, durationMs?: number): void;
  applyMoves(moves: Array<{ layer: CubeMoveLayer; dir: 1 | -1 }>, durationMs?: number): void;
  setFacelets(facelets: string): boolean;
  setFormulaFacelets(facelets: string): boolean;
  setGyroOrientation(quaternion: CubeQuaternion): void;
  resetGyroOrientation(): void;
  resetDisplayOrientation(): void;
  getDisplayState(): CubeDisplayState;
  setInteractionLocked(locked: boolean): void;
  setLowerLayerDimmed(dimmed: boolean): void;
  setBackFaceProjectionDistance(distance: number): void;
  reset(): void;
  setHintMove(move: string | null): void;
  isAnimating(): boolean;
  queueLength(): number;
  dispose(): void;
};

// Default face colors correspond to the yellow-U, green-F orientation.
const FACE_COLORS: Record<CubeFace | "inner", string> = {
  U: "#F2C744",
  D: "#F5F4EF",
  F: "#1F6B3A",
  B: "#1F4FB6",
  L: "#C9352A",
  R: "#E7741A",
  inner: "#0E0E0C",
};
const OLL_DIMMED_STICKER = "#9B9B96";
const LOWER_LAYER_DIMMED_STICKER = OLL_DIMMED_STICKER;

const LAYER_AXIS: Record<CubeMoveLayer, { axis: "x" | "y" | "z"; sign: 1 | -1; coord: -1 | 0 | 1 }> = {
  R: { axis: "x", sign: 1, coord: 1 },
  L: { axis: "x", sign: -1, coord: -1 },
  M: { axis: "x", sign: -1, coord: 0 },
  U: { axis: "y", sign: 1, coord: 1 },
  D: { axis: "y", sign: -1, coord: -1 },
  E: { axis: "y", sign: -1, coord: 0 },
  F: { axis: "z", sign: 1, coord: 1 },
  B: { axis: "z", sign: -1, coord: -1 },
  S: { axis: "z", sign: 1, coord: 0 },
};

const HOME_ORIENTATION = new THREE.Quaternion();
const DEFAULT_CAMERA_DISTANCE = DEFAULT_CUBE_DISPLAY_STATE.cameraDistance;
const MIN_CAMERA_DISTANCE = 5.0;
const MAX_CAMERA_DISTANCE = 14.0;
const CAMERA_ZOOM_SPEED = 0.0014;
const CAMERA_ORBIT_RADIUS_SCALE = Math.sqrt(3);
const DEFAULT_CAMERA_LATITUDE = DEFAULT_CUBE_DISPLAY_STATE.cameraLatitude;
const DEFAULT_CAMERA_LONGITUDE = DEFAULT_CUBE_DISPLAY_STATE.cameraLongitude;
const CAMERA_LATITUDE_LIMIT = 35;
const CAMERA_ORBIT_DRAG_SPEED = 2;
const DEFAULT_MAX_FPS = 120;
const GYRO_SETTLE_ANGLE = 0.001;
const GYRO_FOLLOW_SLERP = 0.35;
const DEFAULT_BACK_FACE_PROJECTION_DISTANCE = 1.8;
const BACK_FACE_PROJECTION_OPACITY = 0.45;
const BACK_FACE_PROJECTION_BORDER_OFFSET = 0.006;
const BACK_FACE_PROJECTION_BORDER_OPACITY = 0.82;

const DEFAULT_GYRO_ORIENTATION: CubeOrientation = { top: "white", front: "green" };
const COLOR_VECTOR: Record<CubeColor, THREE.Vector3> = {
  white: new THREE.Vector3(0, 1, 0),
  yellow: new THREE.Vector3(0, -1, 0),
  green: new THREE.Vector3(0, 0, 1),
  blue: new THREE.Vector3(0, 0, -1),
  red: new THREE.Vector3(1, 0, 0),
  orange: new THREE.Vector3(-1, 0, 0),
};

const HARDWARE_FACE_COLOR: Record<CubeFace, CubeColor> = {
  U: "white",
  D: "yellow",
  F: "green",
  B: "blue",
  R: "red",
  L: "orange",
};

const FACE_VECTOR: Record<CubeFace, THREE.Vector3> = {
  U: new THREE.Vector3(0, 1, 0),
  D: new THREE.Vector3(0, -1, 0),
  R: new THREE.Vector3(1, 0, 0),
  L: new THREE.Vector3(-1, 0, 0),
  F: new THREE.Vector3(0, 0, 1),
  B: new THREE.Vector3(0, 0, -1),
};

type Cubie = THREE.Group & {
  userData: {
    logicalPos: THREE.Vector3;
  };
};

type StickerMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> & {
  userData: {
    stickerLocalFace: CubeFace;
    stickerBaseColor: string;
    stickerBaseFace: CubeFace;
    stickerLowerLayerDimmed: boolean;
  };
};

type HintArrowAssets = {
  group: THREE.Group;
  rings: THREE.Group[];
  geometries: THREE.BufferGeometry[];
  material: THREE.Material;
};

const AXIS_VECTOR: Record<"x" | "y" | "z", THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const HINT_LAYER_COORD_SCALE = 1;
const HINT_MAX_RINGS = 3;

function createHintArrowRing(material: THREE.Material, geometries: THREE.BufferGeometry[]) {
  const group = new THREE.Group();
  const radius = 2.2;
  const tubeRadius = 0.065;
  const arcAngle = (Math.PI * 2) / 3; // 120° arc per arrow

  // Two arrows on opposite sides of the face perimeter so the rotation
  // direction is unambiguous regardless of viewing angle.
  for (let i = 0; i < 2; i++) {
    const arrowGroup = new THREE.Group();

    const torusGeom = new THREE.TorusGeometry(radius, tubeRadius, 10, 40, arcAngle);
    geometries.push(torusGeom);
    const torus = new THREE.Mesh(torusGeom, material);
    torus.renderOrder = 10;
    arrowGroup.add(torus);

    const headLength = tubeRadius * 7.2;
    const headRadius = tubeRadius * 3.4;
    const coneGeom = new THREE.ConeGeometry(headRadius, headLength, 18);
    geometries.push(coneGeom);
    const cone = new THREE.Mesh(coneGeom, material);
    cone.renderOrder = 10;
    // End point of the arc, with the arrowhead extending slightly past it
    // along the tangent so the geometry meets the torus cleanly.
    const tipRadius = radius;
    cone.position.set(Math.cos(arcAngle) * tipRadius, Math.sin(arcAngle) * tipRadius, 0);
    cone.rotation.z = arcAngle; // align cone +Y with tangent at end of arc
    cone.translateY(headLength / 2 - tubeRadius * 0.4);
    arrowGroup.add(cone);

    arrowGroup.rotation.z = i * Math.PI;
    group.add(arrowGroup);
  }

  group.visible = false;
  return group;
}

function createHintArrow(): HintArrowAssets {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0x0e0e0c,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthTest: true,
  });
  const geometries: THREE.BufferGeometry[] = [];
  const rings = Array.from({ length: HINT_MAX_RINGS }, () => {
    const ring = createHintArrowRing(material, geometries);
    group.add(ring);
    return ring;
  });
  group.visible = false;
  return { group, rings, geometries, material };
}

type QueuedMove = {
  layers: CubeMoveLayer[];
  axis: "x" | "y" | "z";
  targetAngle: number;
  physicalTurn: 1 | -1 | 2;
  durationMs: number;
};

type ActiveMove = QueuedMove & {
  pivot: THREE.Group;
  cubies: Cubie[];
  startTime: number;
};

function isInitialLowerLayerSticker(face: CubeFace, y: number) {
  if (face === "D") return true;
  return (face === "F" || face === "B" || face === "R" || face === "L") && y !== 1;
}

function makeCubie(
  x: number,
  y: number,
  z: number,
  colors: Record<CubeFace | "inner", string>,
  orientation: CubeOrientation,
  colorByCubeColor: Record<CubeColor, string>,
  facelets?: string,
  formulaFacelets?: string | null,
  showBackFaceProjection = false,
  backFaceProjectionDistance = DEFAULT_BACK_FACE_PROJECTION_DISTANCE,
  lowerLayerDimmed = false,
  size = 0.96,
): Cubie {
  const group = new THREE.Group() as Cubie;
  const geom = new THREE.BoxGeometry(size, size, size);
  const inner = new THREE.MeshBasicMaterial({ color: colors.inner });
  const cube = new THREE.Mesh(geom, [inner, inner, inner, inner, inner, inner]);
  group.add(cube);

  const stickerSize = 0.86;
  const stickerGeom = new THREE.PlaneGeometry(stickerSize, stickerSize);
  const offset = size / 2 + 0.001;

  const stickers: Array<{
    face: CubeFace;
    cond: boolean;
    pos: [number, number, number];
    rot: [number, number, number];
  }> = [
    { face: "R", cond: x === 1, pos: [offset, 0, 0], rot: [0, Math.PI / 2, 0] },
    { face: "L", cond: x === -1, pos: [-offset, 0, 0], rot: [0, -Math.PI / 2, 0] },
    { face: "U", cond: y === 1, pos: [0, offset, 0], rot: [-Math.PI / 2, 0, 0] },
    { face: "D", cond: y === -1, pos: [0, -offset, 0], rot: [Math.PI / 2, 0, 0] },
    { face: "F", cond: z === 1, pos: [0, 0, offset], rot: [0, 0, 0] },
    { face: "B", cond: z === -1, pos: [0, 0, -offset], rot: [0, Math.PI, 0] },
  ];

  function resolveSticker(sticker: { face: CubeFace }) {
    let stickerColor = colors[sticker.face];
    let stickerBaseFace = sticker.face;

    if (facelets) {
      const hardwarePos = displayPositionToHardware(x, y, z, orientation);
      const hardwareFace = displayFaceToHardware(sticker.face, orientation);
      const facelet = facelets[faceletIndex(hardwareFace, hardwarePos.x, hardwarePos.y, hardwarePos.z)];
      const rawFace = toCubeFace(facelet);
      if (rawFace) {
        stickerBaseFace = rawFace;
        stickerColor = colorByCubeColor[HARDWARE_FACE_COLOR[rawFace]];
      }
    } else if (formulaFacelets) {
      const facelet = formulaFacelets[faceletIndex(sticker.face, x, y, z)];
      if (facelet === "X") {
        stickerColor = OLL_DIMMED_STICKER;
      } else {
        const formulaFace = toCubeFace(facelet);
        if (formulaFace) {
          stickerBaseFace = formulaFace;
          stickerColor = colors[formulaFace];
        }
      }
    }

    return { stickerColor, stickerBaseFace };
  }

  function createStickerMesh(
    sticker: {
      face: CubeFace;
      pos: [number, number, number];
      rot: [number, number, number];
    },
    stickerColor: string,
    stickerBaseFace: CubeFace,
    stickerLowerLayerDimmed: boolean,
    projected: boolean,
  ) {
    const mat = new THREE.MeshBasicMaterial({
      color: lowerLayerDimmed && stickerLowerLayerDimmed ? LOWER_LAYER_DIMMED_STICKER : stickerColor,
      side: projected ? THREE.BackSide : THREE.FrontSide,
      transparent: projected,
      opacity: projected ? BACK_FACE_PROJECTION_OPACITY : 1,
      depthWrite: !projected,
    });
    const mesh = new THREE.Mesh(stickerGeom, mat) as StickerMesh;
    if (projected) {
      const [px, py, pz] = sticker.pos;
      const localNormal = new THREE.Vector3(px, py, pz).normalize();
      mesh.position.copy(localNormal.clone().multiplyScalar(backFaceProjectionDistance));
      mesh.renderOrder = -1;
      mesh.userData.isProjectionSticker = true;
      mesh.userData.projectionLocalNormal = localNormal.clone();
    } else {
      mesh.position.set(...sticker.pos);
    }
    mesh.rotation.set(...sticker.rot);
    mesh.userData.stickerLocalFace = sticker.face;
    mesh.userData.stickerBaseColor = stickerColor;
    mesh.userData.stickerBaseFace = stickerBaseFace;
    mesh.userData.stickerLowerLayerDimmed = stickerLowerLayerDimmed;
    return mesh;
  }

  function createProjectionBorder(sticker: {
    pos: [number, number, number];
    rot: [number, number, number];
  }) {
    const [px, py, pz] = sticker.pos;
    const localNormal = new THREE.Vector3(px, py, pz).normalize();
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(stickerGeom),
      new THREE.LineBasicMaterial({
        color: 0x0e0e0c,
        transparent: true,
        opacity: BACK_FACE_PROJECTION_BORDER_OPACITY,
        depthWrite: false,
      }),
    );
    border.position.copy(localNormal).multiplyScalar(backFaceProjectionDistance + BACK_FACE_PROJECTION_BORDER_OFFSET);
    border.rotation.set(...sticker.rot);
    border.renderOrder = 0;
    // Line segments cannot be culled by THREE.BackSide the way the projection
    // sticker mesh is, so we tag the border with its outward face normal and
    // toggle visibility per frame to match the BackSide rule used by the
    // sticker — only show when the face is pointing away from the camera.
    border.userData.isProjectionBorder = true;
    border.userData.projectionLocalNormal = localNormal.clone();
    return border;
  }

  stickers.forEach((sticker) => {
    if (!sticker.cond) return;
    const { stickerColor, stickerBaseFace } = resolveSticker(sticker);
    const stickerLowerLayerDimmed = isInitialLowerLayerSticker(sticker.face, y);
    group.add(createStickerMesh(sticker, stickerColor, stickerBaseFace, stickerLowerLayerDimmed, false));
    if (showBackFaceProjection) {
      group.add(createStickerMesh(sticker, stickerColor, stickerBaseFace, stickerLowerLayerDimmed, true));
      group.add(createProjectionBorder(sticker));
    }
  });

  group.position.set(x, y, z);
  group.userData.logicalPos = new THREE.Vector3(x, y, z);
  return group;
}

function disposeCubie(cubie: Cubie) {
  cubie.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

function toCubeFace(value: string | undefined): CubeFace | null {
  return value === "U" || value === "D" || value === "L" || value === "R" || value === "F" || value === "B" ? value : null;
}

function isValidFacelets(facelets: string) {
  if (facelets.length !== 54) return false;
  const counts: Record<CubeFace, number> = { U: 0, D: 0, L: 0, R: 0, F: 0, B: 0 };
  for (const facelet of facelets) {
    const face = toCubeFace(facelet);
    if (!face) return false;
    counts[face] += 1;
  }
  return Object.values(counts).every((count) => count === 9);
}

function isValidFormulaFacelets(facelets: string) {
  return /^[UDLRFBX]{54}$/.test(facelets);
}

function faceletIndex(face: CubeFace, x: number, y: number, z: number) {
  switch (face) {
    case "U":
      return (z + 1) * 3 + (x + 1);
    case "R":
      return 9 + (1 - y) * 3 + (1 - z);
    case "F":
      return 18 + (1 - y) * 3 + (x + 1);
    case "D":
      return 27 + (1 - z) * 3 + (x + 1);
    case "L":
      return 36 + (1 - y) * 3 + (z + 1);
    case "B":
      return 45 + (1 - y) * 3 + (1 - x);
  }
}

function vectorToFace(vector: THREE.Vector3): CubeFace {
  const x = Math.round(vector.x);
  const y = Math.round(vector.y);
  const z = Math.round(vector.z);
  if (y === 1) return "U";
  if (y === -1) return "D";
  if (x === 1) return "R";
  if (x === -1) return "L";
  if (z === 1) return "F";
  return "B";
}

function displayPositionToHardware(x: number, y: number, z: number, orientation: CubeOrientation) {
  const top = COLOR_VECTOR[orientation.top] ?? COLOR_VECTOR[DEFAULT_ORIENTATION.top];
  const front = COLOR_VECTOR[orientation.front] ?? COLOR_VECTOR[DEFAULT_ORIENTATION.front];
  const right = new THREE.Vector3().crossVectors(top, front).normalize();
  return new THREE.Vector3()
    .addScaledVector(right, x)
    .addScaledVector(top, y)
    .addScaledVector(front, z)
    .round();
}

function displayFaceToHardware(face: CubeFace, orientation: CubeOrientation) {
  const normal = FACE_VECTOR[face];
  return vectorToFace(displayPositionToHardware(normal.x, normal.y, normal.z, orientation));
}

function selectLayer(cubies: Cubie[], layer: CubeMoveLayer): Cubie[] {
  const { axis, coord } = LAYER_AXIS[layer];
  return cubies.filter((cubie) => Math.round(cubie.userData.logicalPos[axis]) === coord);
}

function selectLayers(cubies: Cubie[], layers: CubeMoveLayer[]): Cubie[] {
  const selected = new Set<Cubie>();
  layers.forEach((layer) => {
    selectLayer(cubies, layer).forEach((cubie) => selected.add(cubie));
  });
  return [...selected];
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function scaleMoveDuration(durationMs: number, backlog: number) {
  if (durationMs <= 0 || backlog <= 1) return durationMs;
  if (backlog >= 12) return Math.max(12, Math.round(durationMs * 0.06));
  if (backlog >= 8) return Math.max(18, Math.round(durationMs * 0.1));
  if (backlog >= 5) return Math.max(28, Math.round(durationMs * 0.18));
  if (backlog >= 3) return Math.max(45, Math.round(durationMs * 0.35));
  return Math.max(80, Math.round(durationMs * 0.6));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function finiteOrDefault(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function makeOrientationBasis(orientation: CubeOrientation) {
  const top = COLOR_VECTOR[orientation.top] ?? COLOR_VECTOR[DEFAULT_GYRO_ORIENTATION.top];
  const front = COLOR_VECTOR[orientation.front] ?? COLOR_VECTOR[DEFAULT_GYRO_ORIENTATION.front];
  const right = new THREE.Vector3().crossVectors(top, front).normalize();
  const matrix = new THREE.Matrix4().makeBasis(right, top, front);
  return new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
}

export type SmartCubeOptions = {
  faceColors?: Partial<Record<CubeFace, string>>;
  orientation?: CubeOrientation;
  maxFps?: number | null;
  autoRotateDegPerSecond?: number;
  compensateInitialGyroOffset?: boolean;
  interactionLocked?: boolean;
  showBackFaceProjection?: boolean;
  backFaceProjectionDistance?: number;
  defaultDisplayState?: Partial<CubeDisplayState> | null;
  initialDisplayState?: CubeDisplayState | null;
  initialFacelets?: string | null;
  initialMoves?: Array<{ layer: CubeMoveLayer; dir: 1 | -1 }>;
  initialGyroQuaternion?: CubeQuaternion | null;
  cameraViewportInsets?: CubeCameraViewportInsets;
  sceneOffset?: CubeSceneOffset;
  onDisplayOrientationChange?: () => void;
};

export function mountSmartCube(
  container: HTMLDivElement,
  options: SmartCubeOptions = {},
): SmartCubeApi {
  const colors: Record<CubeFace | "inner", string> = {
    U: options.faceColors?.U ?? FACE_COLORS.U,
    D: options.faceColors?.D ?? FACE_COLORS.D,
    F: options.faceColors?.F ?? FACE_COLORS.F,
    B: options.faceColors?.B ?? FACE_COLORS.B,
    L: options.faceColors?.L ?? FACE_COLORS.L,
    R: options.faceColors?.R ?? FACE_COLORS.R,
    inner: FACE_COLORS.inner,
  };
  const displayOrientation = options.orientation ?? DEFAULT_ORIENTATION;
  const displayFaceColors = getFaceColors(displayOrientation);
  const colorByCubeColor = Object.fromEntries(
    (Object.entries(displayFaceColors) as Array<[CubeFace, CubeColor]>).map(([face, color]) => [color, colors[face]]),
  ) as Record<CubeColor, string>;
  const showBackFaceProjection = options.showBackFaceProjection ?? false;
  let backFaceProjectionDistance = Number.isFinite(options.backFaceProjectionDistance)
    ? options.backFaceProjectionDistance ?? DEFAULT_BACK_FACE_PROJECTION_DISTANCE
    : DEFAULT_BACK_FACE_PROJECTION_DISTANCE;
  let formulaFacelets: string | null = null;
  let lowerLayerDimmed = false;
  const onDisplayOrientationChange = options.onDisplayOrientationChange;
  const maxFps = options.maxFps === null
    ? null
    : Number.isFinite(options.maxFps) && options.maxFps && options.maxFps > 0
    ? options.maxFps
    : DEFAULT_MAX_FPS;
  const targetFrameMs = maxFps === null ? 0 : 1000 / maxFps;
  const autoRotateDegPerSecond = Number.isFinite(options.autoRotateDegPerSecond)
    ? options.autoRotateDegPerSecond ?? 0
    : 0;
  const compensateInitialGyroOffset = options.compensateInitialGyroOffset ?? true;

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(32, container.clientWidth / container.clientHeight, 0.1, 100);
  const defaultDisplayState: CubeDisplayState = {
    cameraDistance: clamp(
      finiteOrDefault(options.defaultDisplayState?.cameraDistance, DEFAULT_CAMERA_DISTANCE),
      MIN_CAMERA_DISTANCE,
      MAX_CAMERA_DISTANCE,
    ),
    cameraLatitude: clamp(
      finiteOrDefault(options.defaultDisplayState?.cameraLatitude, DEFAULT_CAMERA_LATITUDE),
      -CAMERA_LATITUDE_LIMIT,
      CAMERA_LATITUDE_LIMIT,
    ),
    cameraLongitude: normalizeLongitude(
      finiteOrDefault(options.defaultDisplayState?.cameraLongitude, DEFAULT_CAMERA_LONGITUDE),
    ),
  };
  let cameraDistance = defaultDisplayState.cameraDistance;
  let cameraLatitude = defaultDisplayState.cameraLatitude;
  let cameraLongitude = defaultDisplayState.cameraLongitude;

  function applyCameraViewport(width: number, height: number) {
    const insets = options.cameraViewportInsets;
    if (!insets) {
      camera.clearViewOffset();
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      return;
    }

    const left = Math.max(0, insets.left ?? 0);
    const right = Math.max(0, insets.right ?? 0);
    const top = Math.max(0, insets.top ?? 0);
    const bottom = Math.max(0, insets.bottom ?? 0);
    const viewWidth = Math.max(1, width - left - right);
    const viewHeight = Math.max(1, height - top - bottom);
    camera.aspect = viewWidth / viewHeight;
    camera.setViewOffset(viewWidth, viewHeight, -left, -top, width, height);
    camera.updateProjectionMatrix();
  }

  function applyCameraOrbit() {
    const spherical = new THREE.Spherical(
      cameraDistance * CAMERA_ORBIT_RADIUS_SCALE,
      (90 - cameraLatitude) * Math.PI / 180,
      cameraLongitude * Math.PI / 180,
    );
    spherical.makeSafe();
    camera.position.setFromSpherical(spherical);
    camera.lookAt(0, 0, 0);
  }

  function applyCameraDistance(distance: number) {
    const nextDistance = clamp(distance, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
    const changed = Math.abs(nextDistance - cameraDistance) > 0.001;
    cameraDistance = nextDistance;
    applyCameraOrbit();
    return changed;
  }

  function applyCameraCoordinates(latitude: number, longitude: number) {
    const nextLatitude = clamp(latitude, -CAMERA_LATITUDE_LIMIT, CAMERA_LATITUDE_LIMIT);
    const nextLongitude = normalizeLongitude(longitude);
    const changed =
      Math.abs(nextLatitude - cameraLatitude) > 0.001 ||
      Math.abs(nextLongitude - cameraLongitude) > 0.001;
    cameraLatitude = nextLatitude;
    cameraLongitude = nextLongitude;
    applyCameraOrbit();
    return changed;
  }

  if (options.initialDisplayState) {
    cameraDistance = clamp(
      finiteOrDefault(options.initialDisplayState.cameraDistance, defaultDisplayState.cameraDistance),
      MIN_CAMERA_DISTANCE,
      MAX_CAMERA_DISTANCE,
    );
    cameraLatitude = clamp(
      finiteOrDefault(options.initialDisplayState.cameraLatitude, defaultDisplayState.cameraLatitude),
      -CAMERA_LATITUDE_LIMIT,
      CAMERA_LATITUDE_LIMIT,
    );
    cameraLongitude = normalizeLongitude(
      finiteOrDefault(options.initialDisplayState.cameraLongitude, defaultDisplayState.cameraLongitude),
    );
  }
  applyCameraOrbit();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  applyCameraViewport(Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1));
  container.appendChild(renderer.domElement);

  const viewRoot = new THREE.Group();
  viewRoot.position.set(
    finiteOrDefault(options.sceneOffset?.x, 0),
    finiteOrDefault(options.sceneOffset?.y, 0),
    finiteOrDefault(options.sceneOffset?.z, 0),
  );
  scene.add(viewRoot);

  const cubeRoot = new THREE.Group();
  viewRoot.add(cubeRoot);

  const orientationBasis = makeOrientationBasis(options.orientation ?? DEFAULT_GYRO_ORIENTATION);
  const defaultCubeOrientation = cubeRoot.quaternion.clone();
  const targetCubeOrientation = cubeRoot.quaternion.clone();

  const cubies: Cubie[] = [];
  const queue: QueuedMove[] = [];
  let current: ActiveMove | null = null;
  let frameId = 0;
  let frameTimeoutId = 0;
  let frameScheduled = false;
  let disposed = false;
  let dragging = false;
  let interactionLocked = Boolean(options.interactionLocked);
  let dragStartX = 0;
  let dragStartY = 0;
  let gyroBasis: THREE.Quaternion | null = null;
  let gyroActive = false;

  const hintArrow = createHintArrow();
  cubeRoot.add(hintArrow.group);
  let lastFrameTime = performance.now();
  let hintSpinSign = 1;
  const hintTmpQuat = new THREE.Quaternion();
  const hintDefaultAxis = new THREE.Vector3(0, 0, 1);
  const stickerPosition = new THREE.Vector3();
  const stickerNormal = new THREE.Vector3();
  const cubieWorldQuaternion = new THREE.Quaternion();
  const cubeRootWorldQuaternion = new THREE.Quaternion();
  const cubeRootWorldQuaternionInverse = new THREE.Quaternion();
  const cubieToCubeQuaternion = new THREE.Quaternion();
  const projectionBorderWorldNormal = new THREE.Vector3();
  const projectionBorderWorldPosition = new THREE.Vector3();
  const projectionBorderCameraOffset = new THREE.Vector3();
  const projectionBorderCubieQuaternion = new THREE.Quaternion();

  renderer.domElement.style.touchAction = "none";

  function colorForHardwareFace(face: CubeFace) {
    const hardwareColor = HARDWARE_FACE_COLOR[face];
    const displayFace = (Object.entries(displayFaceColors) as Array<[CubeFace, CubeColor]>).find(
      ([, color]) => color === hardwareColor,
    )?.[0];
    return displayFace ? colors[displayFace] : COLOR_HEX[hardwareColor];
  }

  function rebuildCubies(facelets?: string) {
    cubies.forEach((cubie) => {
      cubeRoot.remove(cubie);
      disposeCubie(cubie);
    });
    cubies.length = 0;
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const cubie = makeCubie(
            x,
            y,
            z,
            colors,
            displayOrientation,
            colorByCubeColor,
            facelets,
            formulaFacelets,
            showBackFaceProjection,
            backFaceProjectionDistance,
            lowerLayerDimmed,
          );
          cubies.push(cubie);
          cubeRoot.add(cubie);
        }
      }
    }
  }

  function applyBackFaceProjectionDistance(distance: number) {
    backFaceProjectionDistance = Number.isFinite(distance) ? distance : DEFAULT_BACK_FACE_PROJECTION_DISTANCE;
    cubies.forEach((cubie) => {
      cubie.children.forEach((child) => {
        const userData = child.userData as {
          isProjectionBorder?: boolean;
          isProjectionSticker?: boolean;
          projectionLocalNormal?: THREE.Vector3;
        };
        if (!userData.projectionLocalNormal || (!userData.isProjectionSticker && !userData.isProjectionBorder)) return;
        const offset = userData.isProjectionBorder
          ? backFaceProjectionDistance + BACK_FACE_PROJECTION_BORDER_OFFSET
          : backFaceProjectionDistance;
        child.position.copy(userData.projectionLocalNormal).multiplyScalar(offset);
      });
    });
  }

  function paintSticker(mesh: StickerMesh, color: string, baseFace: CubeFace) {
    mesh.material.color.set(color);
    mesh.userData.stickerBaseColor = color;
    mesh.userData.stickerBaseFace = baseFace;
  }

  function refreshStickerDisplayColors() {
    cubies.forEach((cubie) => {
      cubie.traverse((child) => {
        const sticker = child as Partial<StickerMesh>;
        if (!sticker.userData?.stickerLocalFace || !(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshBasicMaterial)) return;

        child.material.color.set(
          lowerLayerDimmed && (child as StickerMesh).userData.stickerLowerLayerDimmed
            ? LOWER_LAYER_DIMMED_STICKER
            : (child as StickerMesh).userData.stickerBaseColor,
        );
      });
    });
  }

  function repaintCubies(facelets: string) {
    cubeRoot.getWorldQuaternion(cubeRootWorldQuaternion);
    cubeRootWorldQuaternionInverse.copy(cubeRootWorldQuaternion).invert();

    cubies.forEach((cubie) => {
      cubie.getWorldPosition(stickerPosition);
      cubeRoot.worldToLocal(stickerPosition);
      const x = Math.round(stickerPosition.x);
      const y = Math.round(stickerPosition.y);
      const z = Math.round(stickerPosition.z);
      const hardwarePos = displayPositionToHardware(x, y, z, displayOrientation);

      cubie.getWorldQuaternion(cubieWorldQuaternion);
      cubieToCubeQuaternion.copy(cubeRootWorldQuaternionInverse).multiply(cubieWorldQuaternion).normalize();

      cubie.traverse((child) => {
        const sticker = child as Partial<StickerMesh>;
        const localFace = sticker.userData?.stickerLocalFace;
        if (!localFace || !(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshBasicMaterial)) return;

        stickerNormal.copy(FACE_VECTOR[localFace]).applyQuaternion(cubieToCubeQuaternion).normalize();
        const displayFace = vectorToFace(stickerNormal);
        const hardwareFace = displayFaceToHardware(displayFace, displayOrientation);
        const facelet = facelets[faceletIndex(hardwareFace, hardwarePos.x, hardwarePos.y, hardwarePos.z)];
        const rawFace = toCubeFace(facelet);
        if (!rawFace) return;

        paintSticker(child as StickerMesh, colorForHardwareFace(rawFace), rawFace);
      });
    });
    refreshStickerDisplayColors();
  }

  function startNext() {
    if (current || queue.length === 0) return;
    const next = queue.shift();
    if (!next) return;

    const selectedCubies = selectLayers(cubies, next.layers);
    const pivot = new THREE.Group();
    cubeRoot.add(pivot);
    selectedCubies.forEach((cubie) => pivot.attach(cubie));

    const durationMs = scaleMoveDuration(next.durationMs, queue.length + 1);
    current = {
      ...next,
      durationMs,
      pivot,
      cubies: selectedCubies,
      startTime: performance.now(),
    };
  }

  function rotateLogicalPosition(pos: THREE.Vector3, axis: "x" | "y" | "z", physicalTurn: 1 | -1 | 2) {
    const rotated = new THREE.Vector3();
    if (physicalTurn === 2) {
      if (axis === "x") rotated.set(pos.x, -pos.y, -pos.z);
      else if (axis === "y") rotated.set(-pos.x, pos.y, -pos.z);
      else rotated.set(-pos.x, -pos.y, pos.z);
      return rotated;
    }

    if (axis === "x") {
      rotated.set(pos.x, physicalTurn > 0 ? -pos.z : pos.z, physicalTurn > 0 ? pos.y : -pos.y);
    } else if (axis === "y") {
      rotated.set(physicalTurn > 0 ? pos.z : -pos.z, pos.y, physicalTurn > 0 ? -pos.x : pos.x);
    } else {
      rotated.set(physicalTurn > 0 ? -pos.y : pos.y, physicalTurn > 0 ? pos.x : -pos.x, pos.z);
    }
    return rotated;
  }

  function finishCurrent() {
    if (!current) return;
    const { pivot, cubies: activeCubies, axis, targetAngle, physicalTurn } = current;
    pivot.rotation[axis] = targetAngle;

    activeCubies.forEach((cubie) => {
      cubeRoot.attach(cubie);
      const pos = cubie.userData.logicalPos.clone();
      const rotated = rotateLogicalPosition(pos, axis, physicalTurn);

      rotated.x = Math.round(rotated.x);
      rotated.y = Math.round(rotated.y);
      rotated.z = Math.round(rotated.z);
      cubie.userData.logicalPos.copy(rotated);
    });

    cubeRoot.remove(pivot);
    current = null;
    refreshStickerDisplayColors();
  }

  function hasActiveRenderWork() {
    return !!current || queue.length > 0 || dragging || gyroActive || hintArrow.group.visible || autoRotateDegPerSecond !== 0;
  }

  function updateProjectionBorderVisibility() {
    if (!showBackFaceProjection) return;
    // Mirror THREE.BackSide culling for the line-segment borders: only show a
    // border when its face's outward normal points away from the camera, i.e.
    // the face belongs to the back half of the cube.
    cubies.forEach((cubie) => {
      cubie.getWorldQuaternion(projectionBorderCubieQuaternion);
      cubie.children.forEach((child) => {
        const userData = child.userData as {
          isProjectionBorder?: boolean;
          projectionLocalNormal?: THREE.Vector3;
        };
        if (!userData.isProjectionBorder || !userData.projectionLocalNormal) return;
        projectionBorderWorldNormal
          .copy(userData.projectionLocalNormal)
          .applyQuaternion(projectionBorderCubieQuaternion);
        child.getWorldPosition(projectionBorderWorldPosition);
        projectionBorderCameraOffset.subVectors(projectionBorderWorldPosition, camera.position);
        child.visible = projectionBorderCameraOffset.dot(projectionBorderWorldNormal) > 0;
      });
    });
  }

  function scheduleRender(delayMs = 0) {
    if (disposed || frameScheduled) return;
    frameScheduled = true;

    if (delayMs > 0) {
      frameTimeoutId = window.setTimeout(() => {
        frameTimeoutId = 0;
        frameId = requestAnimationFrame(loop);
      }, delayMs);
      return;
    }

    frameId = requestAnimationFrame(loop);
  }

  function requestRender() {
    scheduleRender();
  }

  function buildQueuedMove(moves: Array<{ layer: CubeMoveLayer; dir: 1 | -1 }>, durationMs: number): QueuedMove | null {
    const first = moves[0];
    if (!first) return null;
    const firstAxis = LAYER_AXIS[first.layer].axis;
    const layerTurns = new Map<CubeMoveLayer, number>();

    for (const move of moves) {
      const { axis, sign } = LAYER_AXIS[move.layer];
      if (axis !== firstAxis) return null;
      const physicalQuarterTurn = -sign * move.dir;
      layerTurns.set(move.layer, (layerTurns.get(move.layer) ?? 0) + physicalQuarterTurn);
    }

    const layers: CubeMoveLayer[] = [];
    let sharedTurn: 1 | -1 | 2 | null = null;
    let sharedTargetTurn: number | null = null;

    for (const [layer, rawTurn] of layerTurns) {
      const normalized = ((rawTurn % 4) + 4) % 4;
      if (normalized === 0) continue;
      const physicalTurn = (normalized === 3 ? -1 : normalized) as 1 | -1 | 2;
      const targetTurn = physicalTurn === 2 && rawTurn < 0 ? -2 : physicalTurn;
      if (sharedTurn !== null && physicalTurn !== sharedTurn) return null;
      if (sharedTargetTurn !== null && targetTurn !== sharedTargetTurn) return null;
      sharedTurn = physicalTurn;
      sharedTargetTurn = targetTurn;
      layers.push(layer);
    }

    if (sharedTurn === null || sharedTargetTurn === null || layers.length === 0) return null;

    return {
      layers,
      axis: firstAxis,
      physicalTurn: sharedTurn,
      targetAngle: sharedTargetTurn * (Math.PI / 2),
      durationMs,
    };
  }

  function applyMovesImmediately(moves: Array<{ layer: CubeMoveLayer; dir: 1 | -1 }>) {
    if (current) finishCurrent();
    const queuedMove = buildQueuedMove(moves, 0);
    if (!queuedMove) {
      moves.forEach((move) => applyMovesImmediately([move]));
      return;
    }
    const selectedCubies = selectLayers(cubies, queuedMove.layers);
    const pivot = new THREE.Group();
    cubeRoot.add(pivot);
    selectedCubies.forEach((cubie) => pivot.attach(cubie));

    current = {
      ...queuedMove,
      pivot,
      cubies: selectedCubies,
      startTime: performance.now(),
    };
    finishCurrent();
  }

  function resetGyroDisplayOrientation() {
    gyroBasis = null;
    gyroActive = false;
    targetCubeOrientation.copy(defaultCubeOrientation);
    cubeRoot.quaternion.copy(defaultCubeOrientation);
  }

  function applyHintMove(move: string | null) {
    hintArrow.rings.forEach((ring) => {
      ring.visible = false;
    });
    if (!move) {
      hintArrow.group.visible = false;
      return;
    }
    const queuedMove = buildQueuedMove(expandMoveNotation(move), 0);
    if (!queuedMove) {
      hintArrow.group.visible = false;
      return;
    }

    hintArrow.group.position.set(0, 0, 0);
    hintArrow.group.quaternion.identity();
    hintArrow.group.scale.set(1, 1, 1);
    const hintDirection: 1 | -1 = queuedMove.targetAngle < 0 ? -1 : 1;
    hintSpinSign = hintDirection;

    queuedMove.layers.slice(0, HINT_MAX_RINGS).forEach((layer, index) => {
      const ring = hintArrow.rings[index];
      const { axis, coord } = LAYER_AXIS[layer];
      const normal = AXIS_VECTOR[axis];

      ring.position.set(0, 0, 0);
      ring.position[axis] = coord * HINT_LAYER_COORD_SCALE;
      // Align the default torus axis (+Z local) with the move axis. The ring
      // then sits through the moving layer instead of floating outside a face.
      hintTmpQuat.setFromUnitVectors(hintDefaultAxis, normal);
      ring.quaternion.copy(hintTmpQuat);
      ring.scale.set(1, hintDirection, 1);
      ring.visible = true;
    });
    hintArrow.group.visible = true;
  }

  function applyGyroQuaternion(quaternion: CubeQuaternion, immediate: boolean) {
    if (interactionLocked) return;
    const hardwareOrientation = new THREE.Quaternion(
      quaternion.x,
      quaternion.z,
      -quaternion.y,
      quaternion.w,
    ).normalize();
    // GAN gyro is reported in the hardware color basis. The rendered cubies
    // are already laid out in the selected display basis, so append that basis
    // instead of conjugating by it.
    const cubeOrientation = hardwareOrientation.clone().multiply(orientationBasis).normalize();

    if (compensateInitialGyroOffset && !gyroBasis) {
      gyroBasis = cubeOrientation.clone().conjugate();
    }

    if (compensateInitialGyroOffset && gyroBasis) {
      targetCubeOrientation.copy(cubeOrientation.premultiply(gyroBasis).premultiply(HOME_ORIENTATION));
    } else {
      targetCubeOrientation.copy(cubeOrientation.premultiply(HOME_ORIENTATION));
    }

    if (immediate) {
      cubeRoot.quaternion.copy(targetCubeOrientation);
      gyroActive = false;
    } else {
      gyroActive = true;
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height);
    applyCameraViewport(width, height);
    requestRender();
  });

  function onPointerDown(event: PointerEvent) {
    if (interactionLocked) return;
    if (!event.isPrimary || event.button !== 0) return;
    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
    requestRender();
  }

  function onPointerMove(event: PointerEvent) {
    if (interactionLocked) return;
    if (!dragging) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const minDim = Math.max(Math.min(rect.width, rect.height), 1);
    const deltaX = event.clientX - dragStartX;
    const deltaY = event.clientY - dragStartY;
    if (Math.abs(deltaX) < 0.1 && Math.abs(deltaY) < 0.1) return;

    const nextLatitude = cameraLatitude + (deltaY / minDim) * CAMERA_ORBIT_DRAG_SPEED * 180 / Math.PI;
    const nextLongitude = cameraLongitude - (deltaX / minDim) * CAMERA_ORBIT_DRAG_SPEED * 180 / Math.PI;
    if (applyCameraCoordinates(nextLatitude, nextLongitude)) {
      onDisplayOrientationChange?.();
      requestRender();
    }
    dragStartX = event.clientX;
    dragStartY = event.clientY;
  }

  function onPointerUp() {
    dragging = false;
    requestRender();
  }

  function onWheel(event: WheelEvent) {
    if (interactionLocked) return;
    event.preventDefault();
    const nextDistance = cameraDistance * (1 + event.deltaY * CAMERA_ZOOM_SPEED);
    if (applyCameraDistance(nextDistance)) onDisplayOrientationChange?.();
    requestRender();
  }

  function loop(now: number) {
    frameId = 0;
    frameScheduled = false;
    if (disposed) return;

    const frameElapsedMs = now - lastFrameTime;
    if (targetFrameMs > 0 && frameElapsedMs < targetFrameMs) {
      scheduleRender(targetFrameMs - frameElapsedMs);
      return;
    }

    const deltaSec = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    if (autoRotateDegPerSecond !== 0 && !dragging) {
      applyCameraCoordinates(cameraLatitude, cameraLongitude + autoRotateDegPerSecond * deltaSec);
    }
    if (!current) startNext();
    if (current) {
      const t = Math.min(1, (now - current.startTime) / current.durationMs);
      current.pivot.rotation[current.axis] = current.targetAngle * easeInOutCubic(t);
      if (t >= 1) finishCurrent();
    }
    if (gyroActive) {
      if (cubeRoot.quaternion.angleTo(targetCubeOrientation) < GYRO_SETTLE_ANGLE) {
        cubeRoot.quaternion.copy(targetCubeOrientation);
        gyroActive = false;
      } else {
        cubeRoot.quaternion.slerp(targetCubeOrientation, GYRO_FOLLOW_SLERP);
      }
    }
    if (hintArrow.group.visible) {
      // Slow rotation about each local move axis makes the arrows orbit the
      // exact layer they describe, including wide and middle-slice moves.
      hintArrow.rings.forEach((ring) => {
        if (ring.visible) ring.rotateZ(deltaSec * 0.9 * hintSpinSign);
      });
    }
    updateProjectionBorderVisibility();
    renderer.render(scene, camera);
    if (hasActiveRenderWork()) scheduleRender();
  }

  const initialFacelets = options.initialFacelets && isValidFacelets(options.initialFacelets)
    ? options.initialFacelets
    : undefined;
  rebuildCubies(initialFacelets);
  if (options.initialMoves && options.initialMoves.length > 0) {
    applyMovesImmediately(options.initialMoves);
  }
  if (options.initialGyroQuaternion) {
    applyGyroQuaternion(options.initialGyroQuaternion, true);
  }
  resizeObserver.observe(container);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  requestRender();

  return {
    applyMove(layer, dir = 1, durationMs = 180) {
      this.applyMoves([{ layer, dir }], durationMs);
    },
    applyMoves(moves, durationMs = 180) {
      if (moves.length === 0) return;
      if (durationMs <= 0) {
        applyMovesImmediately(moves);
        requestRender();
        return;
      }
      const queuedMove = buildQueuedMove(moves, durationMs);
      if (queuedMove) {
        queue.push(queuedMove);
        requestRender();
        return;
      }
      moves.forEach((move) => {
        const singleMove = buildQueuedMove([move], durationMs);
        if (singleMove) queue.push(singleMove);
      });
      requestRender();
    },
    setFacelets(facelets) {
      if (!isValidFacelets(facelets)) return false;
      formulaFacelets = null;
      queue.length = 0;
      if (current) finishCurrent();
      repaintCubies(facelets);
      requestRender();
      return true;
    },
    setFormulaFacelets(facelets) {
      if (!isValidFormulaFacelets(facelets)) return false;
      formulaFacelets = facelets;
      queue.length = 0;
      if (current) finishCurrent();
      rebuildCubies();
      refreshStickerDisplayColors();
      requestRender();
      return true;
    },
    setGyroOrientation(quaternion) {
      applyGyroQuaternion(quaternion, false);
      requestRender();
    },
    resetGyroOrientation() {
      resetGyroDisplayOrientation();
      requestRender();
    },
    resetDisplayOrientation() {
      applyCameraDistance(defaultDisplayState.cameraDistance);
      applyCameraCoordinates(defaultDisplayState.cameraLatitude, defaultDisplayState.cameraLongitude);
      requestRender();
    },
    getDisplayState() {
      return {
        cameraDistance,
        cameraLatitude,
        cameraLongitude,
      };
    },
    setInteractionLocked(locked) {
      interactionLocked = locked;
      if (locked) {
        dragging = false;
        gyroBasis = null;
        gyroActive = false;
        targetCubeOrientation.copy(cubeRoot.quaternion);
      }
      requestRender();
    },
    reset() {
      queue.length = 0;
      if (current) finishCurrent();
      formulaFacelets = null;
      rebuildCubies();
      refreshStickerDisplayColors();
      requestRender();
    },
    setLowerLayerDimmed(dimmed) {
      lowerLayerDimmed = dimmed;
      refreshStickerDisplayColors();
      requestRender();
    },
    setBackFaceProjectionDistance(distance) {
      applyBackFaceProjectionDistance(distance);
      requestRender();
    },
    setHintMove(move) {
      applyHintMove(move);
      requestRender();
    },
    isAnimating() {
      return !!current || queue.length > 0;
    },
    queueLength() {
      return queue.length + (current ? 1 : 0);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      if (frameTimeoutId) window.clearTimeout(frameTimeoutId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      hintArrow.geometries.forEach((geom) => geom.dispose());
      hintArrow.material.dispose();
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
