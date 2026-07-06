import {
  DEFAULT_CUBE_DISPLAY_STATE,
  type CubeCameraViewportInsets,
  type CubeDisplayState,
  type CubeSceneOffset,
} from "@/lib/smart-cube";

export type CubeCameraPreset = {
  displayState: CubeDisplayState;
  viewportInsets?: CubeCameraViewportInsets;
  sceneOffset?: CubeSceneOffset;
};

export const CUBE_CAMERA_PRESETS = {
  practice: {
    displayState: {
      ...DEFAULT_CUBE_DISPLAY_STATE,
      cameraDistance: 8,
    },
    sceneOffset: {
      y: 0.7,
    },
  },
  trainer: {
    displayState: {
      ...DEFAULT_CUBE_DISPLAY_STATE,
      cameraDistance: 8,
    },
    sceneOffset: {
      y: 0.7,
    },
  },
  formulas: {
    displayState: {
      ...DEFAULT_CUBE_DISPLAY_STATE,
    },
  },
} as const satisfies Record<"practice" | "trainer" | "formulas", CubeCameraPreset>;
