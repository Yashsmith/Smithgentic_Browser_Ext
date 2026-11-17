// Chrome/Edge helpers. Pure functions taking the namespace so no `chrome.*`
// runs at import time. The side panel is Chromium's `sidePanel` API.

export function cdpSupported(ns) {
  return typeof ns?.debugger?.attach === "function" && typeof ns?.debugger?.sendCommand === "function";
}

// Shown by the options page when the browser lacks the debugger API.
export const CDP_HINT = "Not available in this browser (no debugger API)";

export const JS_HINT = "Not available in this build";

// A disabled toggle plus copy: a box the user can turn on would promise a tool that can never run.
export function toolToggle(available, hint) {
  if (available) return { disabled: false };
  return { disabled: true, hint };
}

// The run-JavaScript tool is available in Chromium builds.
export function jsToolSupported() {
  return true;
}

export async function openPanel(ns, tabId) {
  try {
    if (typeof ns?.sidePanel?.open !== "function") return undefined;
    await ns.sidePanel.open({ tabId });
    return true;
  } catch {
    return false;
  }
}

export function setPanelBehaviorOnActionClick(ns) {
  if (typeof ns?.sidePanel?.setPanelBehavior !== "function") return false;
  try {
    const r = ns.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    // A rejected behavior call must not surface as an unhandled rejection at install.
    r?.catch?.(() => {});
    return true;
  } catch {
    return false;
  }
}
