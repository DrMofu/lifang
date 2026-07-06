import { parseAlgorithm } from "@/lib/algorithms";
import { isSolvedFacelets } from "@/lib/cube-state";
import { faceletsToPattern, validateFacelets } from "@/lib/facelets-pattern";

export async function solveFacelets(facelets: string): Promise<string[]> {
  try {
    validateFacelets(facelets);
    if (isSolvedFacelets(facelets)) {
      throw new Error("当前魔方已经是复原态。");
    }

    const [{ experimentalSolve3x3x3IgnoringCenters }, pattern] = await Promise.all([
      import("cubing/search"),
      faceletsToPattern(facelets),
    ]);
    const solution = await experimentalSolve3x3x3IgnoringCenters(pattern);
    const steps = parseAlgorithm(solution.toString());

    if (steps.length === 0) {
      throw new Error("未生成可执行的复原公式。");
    }

    return steps;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("求解失败，请重新同步魔方状态后再试。");
  }
}
