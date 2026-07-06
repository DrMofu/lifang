"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { AppFooter, CompactConnectButton, NavIcon } from "@/components/app-shell";
import { useCubeAppearance } from "@/components/cube-appearance-provider";
import { useCubeConnection, type CubeVisualState } from "@/components/cube-connection-provider";
import { expandMoveNotation } from "@/lib/algorithms";
import { type SmartCubeApi, mountSmartCube } from "@/lib/smart-cube";

const HOME_NAV = [
  { href: "/practice", label: "练习", icon: "practice", index: "01" },
  { href: "/formulas", label: "公式", icon: "cube", index: "02" },
  { href: "/stats", label: "统计", icon: "stats", index: "03" },
  { href: "/settings", label: "设置", icon: "settings", index: "04" },
];

export function HomeLandingApp() {
  const cubeMountRef = useRef<HTMLDivElement | null>(null);
  const cubeApiRef = useRef<SmartCubeApi | null>(null);
  const visualStateRef = useRef<CubeVisualState>({ baseFacelets: null, moves: [] });
  const faceletsRef = useRef<string | null>(null);
  const lastAppliedFaceletsRef = useRef<string | null>(null);
  const hasRealtimeMovesRef = useRef(false);
  const {
    facelets,
    visualState,
    subscribeMove,
    subscribeFacelets,
  } = useCubeConnection();
  const { orientation, faceColors, renderMaxFps, backFaceProjectionEnabled, backFaceProjectionDistance } = useCubeAppearance();

  visualStateRef.current = visualState;
  faceletsRef.current = facelets;

  const restoreVisualCubeState = useCallback((api: SmartCubeApi) => {
    const visualStateSnapshot = visualStateRef.current;
    const baseFacelets = visualStateSnapshot.baseFacelets ?? faceletsRef.current;
    if (!baseFacelets || !api.setFacelets(baseFacelets)) return;

    lastAppliedFaceletsRef.current = baseFacelets;
    const restoredMoves = visualStateSnapshot.baseFacelets ? visualStateSnapshot.moves : [];
    const expandedMoves = restoredMoves.flatMap((move) => expandMoveNotation(move.move));
    if (expandedMoves.length > 0) api.applyMoves(expandedMoves, 0);
  }, []);

  useEffect(() => {
    if (!cubeMountRef.current) return;
    const api = mountSmartCube(cubeMountRef.current, {
      faceColors,
      orientation,
      maxFps: renderMaxFps,
      showBackFaceProjection: backFaceProjectionEnabled,
      backFaceProjectionDistance,
      initialDisplayState: {
        cameraDistance: 6.1,
        cameraLatitude: 23,
        cameraLongitude: 35,
      },
      autoRotateDegPerSecond: 4,
    });
    cubeApiRef.current = api;
    restoreVisualCubeState(api);

    return () => {
      api.dispose();
      if (cubeApiRef.current === api) cubeApiRef.current = null;
    };
  }, [backFaceProjectionEnabled, faceColors, orientation, renderMaxFps, restoreVisualCubeState]);

  useEffect(() => {
    cubeApiRef.current?.setBackFaceProjectionDistance(backFaceProjectionDistance);
  }, [backFaceProjectionDistance]);

  useEffect(() => {
    if (!facelets || facelets === lastAppliedFaceletsRef.current || hasRealtimeMovesRef.current) return;
    if (cubeApiRef.current?.setFacelets(facelets)) {
      lastAppliedFaceletsRef.current = facelets;
    }
  }, [facelets]);

  useEffect(() => subscribeMove((move) => {
    hasRealtimeMovesRef.current = true;
    const expandedMoves = expandMoveNotation(move);
    expandedMoves.forEach((turn) => {
      cubeApiRef.current?.applyMove(turn.layer, turn.dir, 180);
    });
  }), [subscribeMove]);

  useEffect(() => subscribeFacelets((nextFacelets) => {
    if (hasRealtimeMovesRef.current && cubeApiRef.current?.isAnimating()) {
      lastAppliedFaceletsRef.current = nextFacelets;
      return;
    }
    if (cubeApiRef.current?.setFacelets(nextFacelets)) {
      lastAppliedFaceletsRef.current = nextFacelets;
      hasRealtimeMovesRef.current = false;
    }
  }), [subscribeFacelets]);

  return (
    <div className="app lf-home-app">
      <main className="home-main">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-copy">
            <h1 id="home-title">
              <img className="home-banner" src="/banner.png" alt="立方" />
            </h1>
            <nav className="home-nav topnav" aria-label="首页导航">
              {HOME_NAV.map((item) => (
                <Link key={item.href} className="navitem" href={item.href}>
                  <NavIcon name={item.icon} />
                  <span>{item.label}</span>
                  <small>{item.index}</small>
                </Link>
              ))}
            </nav>
            <div className="home-actions">
              <CompactConnectButton />
            </div>
          </div>

          <div className="home-cube-stage" aria-label="智能魔方实时显示">
            <div className="home-cube-mount" ref={cubeMountRef} />
          </div>
        </section>
      </main>

      <AppFooter />
    </div>
  );
}
