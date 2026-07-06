"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_BACK_FACE_PROJECTION_DISTANCE,
  DEFAULT_BACK_FACE_PROJECTION_ENABLED,
  DEFAULT_COLOR_PALETTE_ID,
  DEFAULT_ORIENTATION,
  DEFAULT_RENDER_MAX_FPS,
  getFaceHexColors,
  isValidOrientation,
  loadBackFaceProjectionDistance,
  loadBackFaceProjectionEnabled,
  loadCubeColorPaletteId,
  loadCubeRenderMaxFps,
  loadCubeOrientation,
  normalizeBackFaceProjectionDistance,
  saveBackFaceProjectionDistance,
  saveBackFaceProjectionEnabled,
  saveCubeColorPaletteId,
  saveCubeRenderMaxFps,
  saveCubeOrientation,
  type CubeColorPaletteId,
  type CubeRenderMaxFps,
  type CubeOrientation,
} from "@/lib/cube-appearance";
import { subscribeStatisticsArchiveChange } from "@/lib/solve-history";
import type { CubeFace } from "@/lib/smart-cube";
import { touchLocalUserDataPackageUpdatedAt } from "@/lib/user-data-package";

type CubeAppearanceContextValue = {
  orientation: CubeOrientation;
  colorPaletteId: CubeColorPaletteId;
  faceColors: Record<CubeFace, string>;
  renderMaxFps: CubeRenderMaxFps;
  backFaceProjectionEnabled: boolean;
  backFaceProjectionDistance: number;
  setOrientation(next: CubeOrientation): void;
  setColorPaletteId(next: CubeColorPaletteId): void;
  setRenderMaxFps(next: CubeRenderMaxFps): void;
  setBackFaceProjectionEnabled(next: boolean): void;
  setBackFaceProjectionDistance(next: number): void;
  resetOrientation(): void;
  resetColorPalette(): void;
};

const CubeAppearanceContext = createContext<CubeAppearanceContextValue | null>(null);

export function CubeAppearanceProvider({ children }: { children: ReactNode }) {
  const [orientation, setOrientationState] = useState<CubeOrientation>(DEFAULT_ORIENTATION);
  const [colorPaletteId, setColorPaletteIdState] = useState<CubeColorPaletteId>(DEFAULT_COLOR_PALETTE_ID);
  const [renderMaxFps, setRenderMaxFpsState] = useState<CubeRenderMaxFps>(DEFAULT_RENDER_MAX_FPS);
  const [backFaceProjectionEnabled, setBackFaceProjectionEnabledState] = useState<boolean>(
    DEFAULT_BACK_FACE_PROJECTION_ENABLED,
  );
  const [backFaceProjectionDistance, setBackFaceProjectionDistanceState] = useState<number>(
    DEFAULT_BACK_FACE_PROJECTION_DISTANCE,
  );

  useEffect(() => {
    function refreshAppearanceSettings() {
      setOrientationState(loadCubeOrientation());
      setColorPaletteIdState(loadCubeColorPaletteId());
      setRenderMaxFpsState(loadCubeRenderMaxFps());
      setBackFaceProjectionEnabledState(loadBackFaceProjectionEnabled());
      setBackFaceProjectionDistanceState(loadBackFaceProjectionDistance());
    }

    refreshAppearanceSettings();
    return subscribeStatisticsArchiveChange(refreshAppearanceSettings);
  }, []);

  const setOrientation = useCallback((next: CubeOrientation) => {
    if (!isValidOrientation(next.top, next.front)) return;
    setOrientationState(next);
    saveCubeOrientation(next);
    touchLocalUserDataPackageUpdatedAt();
  }, []);

  const resetOrientation = useCallback(() => {
    setOrientationState(DEFAULT_ORIENTATION);
    saveCubeOrientation(DEFAULT_ORIENTATION);
    touchLocalUserDataPackageUpdatedAt();
  }, []);

  const setColorPaletteId = useCallback((next: CubeColorPaletteId) => {
    setColorPaletteIdState(next);
    saveCubeColorPaletteId(next);
    touchLocalUserDataPackageUpdatedAt();
  }, []);

  const resetColorPalette = useCallback(() => {
    setColorPaletteIdState(DEFAULT_COLOR_PALETTE_ID);
    saveCubeColorPaletteId(DEFAULT_COLOR_PALETTE_ID);
    touchLocalUserDataPackageUpdatedAt();
  }, []);

  const setRenderMaxFps = useCallback((next: CubeRenderMaxFps) => {
    setRenderMaxFpsState(next);
    saveCubeRenderMaxFps(next);
    touchLocalUserDataPackageUpdatedAt();
  }, []);

  const setBackFaceProjectionEnabled = useCallback((next: boolean) => {
    setBackFaceProjectionEnabledState(next);
    saveBackFaceProjectionEnabled(next);
    touchLocalUserDataPackageUpdatedAt();
  }, []);

  const setBackFaceProjectionDistance = useCallback((next: number) => {
    const normalized = normalizeBackFaceProjectionDistance(next);
    setBackFaceProjectionDistanceState(normalized);
    saveBackFaceProjectionDistance(normalized);
    touchLocalUserDataPackageUpdatedAt();
  }, []);

  const faceColors = useMemo(() => getFaceHexColors(orientation, colorPaletteId), [orientation, colorPaletteId]);

  const value = useMemo<CubeAppearanceContextValue>(
    () => ({
      orientation,
      colorPaletteId,
      faceColors,
      renderMaxFps,
      backFaceProjectionEnabled,
      backFaceProjectionDistance,
      setOrientation,
      setColorPaletteId,
      setRenderMaxFps,
      setBackFaceProjectionEnabled,
      setBackFaceProjectionDistance,
      resetOrientation,
      resetColorPalette,
    }),
    [
      orientation,
      colorPaletteId,
      faceColors,
      renderMaxFps,
      backFaceProjectionEnabled,
      backFaceProjectionDistance,
      setOrientation,
      setColorPaletteId,
      setRenderMaxFps,
      setBackFaceProjectionEnabled,
      setBackFaceProjectionDistance,
      resetOrientation,
      resetColorPalette,
    ],
  );

  return <CubeAppearanceContext.Provider value={value}>{children}</CubeAppearanceContext.Provider>;
}

export function useCubeAppearance(): CubeAppearanceContextValue {
  const ctx = useContext(CubeAppearanceContext);
  if (!ctx) throw new Error("useCubeAppearance must be used within CubeAppearanceProvider");
  return ctx;
}
