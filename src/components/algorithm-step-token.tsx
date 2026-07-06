import { MoveToken } from "@/components/move-token";

export type AlgorithmStepStatus = "pending" | "partial" | "correct" | "wrong";

type AlgorithmStepTokenProps = {
  move: string;
  index: number;
  status?: AlgorithmStepStatus;
  active?: boolean;
  className?: string;
};

export function AlgorithmStepToken({
  move,
  index,
  status = "pending",
  active = false,
  className,
}: AlgorithmStepTokenProps) {
  return (
    <span
      className={[
        "algo-tok",
        status === "partial" ? "partial" : "",
        status === "correct" ? "done" : "",
        status === "wrong" ? "wrong" : "",
        active ? "next" : "",
        className,
      ].filter(Boolean).join(" ")}
    >
      <span className="algo-tok-index">{index + 1}</span>
      <MoveToken move={move} />
    </span>
  );
}
