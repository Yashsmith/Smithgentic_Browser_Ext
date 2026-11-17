import { TabSession } from "../chrome/session.js";
import { Coordinate } from "../protocol/actions.js";
import { InputStateManager } from "./state.js";
import { dispatchDragGesture } from "./drag-runtime.js";

export class DragController {
  constructor(private session: TabSession, private inputState: InputStateManager) {}

  public async drag(path: Coordinate[], explicitModifiers = 0, signal?: AbortSignal): Promise<void> {
    if (path.length < 2 || path.length > 50 || path.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      throw new Error("Drag requires 2–50 finite points");
    }
    const modifiers = this.inputState.getEffectiveModifiers(explicitModifiers);
    const sessionId = this.session.sessionId;
    try {
      await dispatchDragGesture({
        path,
        check: () => {
          if (signal?.aborted || this.session.sessionId !== sessionId) throw new Error("ACTION_CANCELLED");
        },
        subscribe: handler => {
          this.session.on("dragIntercepted", handler);
          return () => this.session.off("dragIntercepted", handler);
        },
        send: async (method, params) => {
          if (this.session.sessionId !== sessionId) throw new Error("ACTION_CANCELLED");
          if (method === "Input.dispatchMouseEvent" || method === "Input.dispatchDragEvent") {
            this.inputState.setCursorPosition(params.x, params.y);
            if (params.type === "mousePressed") this.inputState.setMouseDown("left");
            if (params.type === "mouseReleased") this.inputState.setMouseUp("left");
            return this.session.send(method, {
              ...params, modifiers,
              ...(method === "Input.dispatchMouseEvent" ? { buttons: this.inputState.buttonsBitmask } : {}),
            });
          }
          return this.session.send(method, params);
        },
      });
    } finally {
      this.inputState.setMouseUp("left");
    }
  }
}
