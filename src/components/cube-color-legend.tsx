import type { CubeFace } from "@/lib/smart-cube";

const CUBE_FACE_LEGEND: Array<{ face: CubeFace; label: string }> = [
  { face: "U", label: "U 上" },
  { face: "F", label: "F 前" },
  { face: "R", label: "R 右" },
  { face: "D", label: "D 下" },
  { face: "B", label: "B 后" },
  { face: "L", label: "L 左" },
];

type CubeColorLegendProps = {
  faceColors: Record<CubeFace, string>;
  className?: string;
  "aria-label"?: string;
};

export function CubeColorLegend({ faceColors, className, "aria-label": ariaLabel }: CubeColorLegendProps) {
  return (
    <div className={["legend-grid", className].filter(Boolean).join(" ")} aria-label={ariaLabel}>
      {CUBE_FACE_LEGEND.map(({ face, label }) => (
        <div key={face} className="lg-row">
          <span className="lg-sw" style={{ background: faceColors[face] }}></span>
          {label}
        </div>
      ))}
    </div>
  );
}
