type MoveTokenProps = {
  move: string;
  className?: string;
};

export function MoveToken({ move, className }: MoveTokenProps) {
  const face = move[0] ?? "";
  const suffix = move.slice(1);
  const hasDoubleTurn = suffix.includes("2");

  return (
    <span className={["move-token", hasDoubleTurn ? "move-token-double" : "", className].filter(Boolean).join(" ")}>
      <span className="move-token-face">{face}</span>
      <span className="move-token-suffix">{suffix}</span>
    </span>
  );
}
