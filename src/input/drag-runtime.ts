export interface DragPoint { x: number; y: number }

export function interpolateDragPath(path: DragPoint[], maxMoves = 120): DragPoint[] {
  const lengths = path.slice(1).map((point, i) => Math.hypot(point.x - path[i].x, point.y - path[i].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0);
  let budget = Math.min(maxMoves, Math.max(path.length - 1, Math.ceil(remaining / 20)));
  const moves: DragPoint[] = [];
  for (let i = 1; i < path.length; i++) {
    const length = lengths[i - 1];
    const reserve = path.length - 1 - i;
    const steps = Math.max(1, Math.min(budget - reserve, Math.round(budget * (remaining ? length / remaining : 0))));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      moves.push({
        x: path[i - 1].x + (path[i].x - path[i - 1].x) * t,
        y: path[i - 1].y + (path[i].y - path[i - 1].y) * t,
      });
    }
    budget -= steps;
    remaining -= length;
  }
  return moves;
}

export interface DragGestureOptions {
  path: DragPoint[];
  send: (method: string, params: Record<string, any>) => Promise<unknown>;
  subscribe: (handler: (event: { data: unknown }) => void) => () => void;
  check?: () => void;
  durationMs?: number;
  holdMs?: number;
}

export async function dispatchDragGesture({
  path,
  send,
  subscribe,
  check = () => {},
  durationMs = 240,
  holdMs = 60,
}: DragGestureOptions): Promise<{ point: DragPoint; mode: "html" | "pointer" }> {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  let data: unknown;
  const unsubscribe = subscribe((event) => { data = event.data; });
  let point = path[0];
  let pressed = false;
  let entered = false;
  let failure: unknown;
  try {
    check();
    await send("Input.setInterceptDrags", { enabled: true });
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "none", buttons: 0 });
    await sleep(16);
    check();
    pressed = true;
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
    await sleep(holdMs);
    const moves = interpolateDragPath(path);
    const startedAt = performance.now();
    for (const [index, next] of moves.entries()) {
      check();
      point = next;
      if (data) {
        if (!entered) {
          await send("Input.dispatchDragEvent", { type: "dragEnter", ...point, data });
          entered = true;
        }
        await send("Input.dispatchDragEvent", { type: "dragOver", ...point, data });
      } else {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "left", buttons: 1 });
      }
      await sleep(startedAt + durationMs * (index + 1) / moves.length - performance.now());
    }
    check();
    if (data) {
      if (!entered) await send("Input.dispatchDragEvent", { type: "dragEnter", ...point, data });
      await send("Input.dispatchDragEvent", { type: "dragOver", ...point, data });
      await send("Input.dispatchDragEvent", { type: "drop", ...point, data });
    }
  } catch (error) {
    failure = error;
    await send("Input.cancelDragging", {}).catch(() => {});
  } finally {
    if (pressed) {
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 })
        .catch((error) => { failure ??= error; });
    }
    await send("Input.setInterceptDrags", { enabled: false }).catch((error) => { failure ??= error; });
    unsubscribe();
  }
  if (failure) throw failure;
  return { point, mode: data ? "html" : "pointer" };
}
