import type { CubeFace } from "@/lib/smart-cube";
import { useLanguage } from "@/components/language-provider";
import type { MessageKey } from "@/lib/i18n-messages";

const CUBE_FACE_LEGEND: Array<{ face: CubeFace; labelKey: MessageKey }> = [
  { face: "U", labelKey: "cube.face.u" },
  { face: "F", labelKey: "cube.face.f" },
  { face: "R", labelKey: "cube.face.r" },
  { face: "D", labelKey: "cube.face.d" },
  { face: "B", labelKey: "cube.face.b" },
  { face: "L", labelKey: "cube.face.l" },
];

type CubeColorLegendProps = {
  faceColors: Record<CubeFace, string>;
  className?: string;
  "aria-label"?: string;
};

export function CubeColorLegend({ faceColors, className, "aria-label": ariaLabel }: CubeColorLegendProps) {
  const { t } = useLanguage();
  return (
    <div className={["legend-grid", className].filter(Boolean).join(" ")} aria-label={ariaLabel}>
      {CUBE_FACE_LEGEND.map(({ face, labelKey }) => (
        <div key={face} className="lg-row">
          <span className="lg-sw" style={{ background: faceColors[face] }}></span>
          {t(labelKey)}
        </div>
      ))}
    </div>
  );
}
