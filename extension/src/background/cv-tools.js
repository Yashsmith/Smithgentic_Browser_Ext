// Vision/CV tools: high-detail screenshot crops, local OCR, and real pointer
// input for canvas apps and nested UIs. These complement the DOM tools in
// tools.js: use DOM refs when the page exposes elements, coordinates when it
// does not (canvas, cross-origin frames, visual-only widgets).

import { ensureAttached, sendCommand } from "./cdp.js";
import { recognizeScreenshot } from "../../ocr.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

function fail(message) {
  return { ok: false, error: message };
}

async function captureVisible(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return fail("No active tab to capture.");
  }
  const [front] = await chrome.tabs.query({ active: true, windowId: tab.windowId }).catch(() => []);
  if (front?.id !== tabId) {
    return fail("The tab isn't in front in its window. Call switch_tab with its tab_id first.");
  }
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const [again] = await chrome.tabs.query({ active: true, windowId: tab.windowId }).catch(() => []);
    if (again?.id !== tabId) return fail("The tab changed while capturing. Try again.");
    return { ok: true, tab, data: dataUrl.split(",")[1] };
  } catch (e) {
    return fail("Could not capture a screenshot (restricted page, or the tab isn't visible): " + (e.message || e));
  }
}

async function decode(data) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  return bitmap;
}

function regionArgs(args) {
  const x = Number(args.x ?? 0);
  const y = Number(args.y ?? 0);
  const width = Number(args.width ?? 1000);
  const height = Number(args.height ?? 1000);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1000 || y + height > 1000) return null;
  return { x, y, width, height };
}

export async function inspectRegion(tabId, args = {}) {
  const region = regionArgs(args);
  if (!region) return fail("x, y, width and height must describe a normalized 0-1000 region.");
  const shot = await captureVisible(tabId);
  if (!shot.ok) return shot;
  const format = args.format === "jpeg" || args.format === "webp" ? args.format : "png";
  const quality = Math.min(100, Math.max(1, Number(args.quality) || 90));
  let bitmap;
  try {
    bitmap = await decode(shot.data);
    const sx = Math.floor(region.x / 1000 * bitmap.width);
    const sy = Math.floor(region.y / 1000 * bitmap.height);
    const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(region.width / 1000 * bitmap.width)));
    const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(region.height / 1000 * bitmap.height)));
    const canvas = new OffscreenCanvas(sw, sh);
    canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await canvas.convertToBlob({ type: `image/${format}`, quality: quality / 100 });
    const encoded = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < encoded.length; i += 8192) binary += String.fromCharCode(...encoded.subarray(i, i + 8192));
    return {
      ok: true,
      url: shot.tab.url,
      image: { mediaType: `image/${format}`, data: btoa(binary) },
      region,
      note: `High-detail crop for x=${region.x}, y=${region.y}, width=${region.width}, height=${region.height} attached. click_at uses full-viewport 0-1000 coordinates.`,
    };
  } catch (e) {
    return fail("Could not crop the screenshot: " + (e.message || e));
  } finally {
    bitmap?.close?.();
  }
}

export async function readImageText(tabId, args = {}) {
  const shot = await captureVisible(tabId);
  if (!shot.ok) return shot;
  let bitmap;
  try {
    bitmap = await decode(shot.data);
    const ocr = await recognizeScreenshot(
      { data: shot.data, width: bitmap.width, height: bitmap.height },
      "png",
      chrome,
    );
    if (ocr?.status === "error") return fail("Local OCR failed: " + (ocr.message || "unknown error"));
    const lines = Array.isArray(ocr?.lines) ? ocr.lines : [];
    return {
      ok: true,
      url: shot.tab.url,
      text: lines.map((line) => line.text).join("\n"),
      lines,
      note: lines.length
        ? "Text read locally from the screenshot. Use lines[].x/y with click_at/scroll_at if needed."
        : "No readable text found in the visible screenshot. Try a crop with inspect_region if the text is small.",
    };
  } catch (e) {
    return fail("Could not read the screenshot: " + (e.message || e));
  } finally {
    bitmap?.close?.();
  }
}

async function viewport(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ width: innerWidth, height: innerHeight, scrollX, scrollY }),
    });
    const vp = result?.result;
    if (!vp || !(vp.width > 0) || !(vp.height > 0)) return null;
    return vp;
  } catch {
    return null;
  }
}

async function point(tabId, args = {}) {
  const vp = await viewport(tabId);
  if (!vp) return null;
  const x = Number(args.x ?? 500);
  const y = Number(args.y ?? 500);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000) return null;
  return { vp, x: Math.max(0, Math.min(vp.width - 1, x / 1000 * vp.width)), y: Math.max(0, Math.min(vp.height - 1, y / 1000 * vp.height)) };
}

export async function movePointer(tabId, args = {}) {
  const p = await point(tabId, args);
  if (!p) return fail("x and y must be normalized 0-1000 coordinates.");
  try {
    await ensureAttached(tabId);
    await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none", buttons: 0 });
    return { ok: true, x: Math.round(p.x), y: Math.round(p.y) };
  } catch (e) {
    return fail("Could not move the pointer: " + (e.message || e));
  }
}

export async function clickAt(tabId, args = {}, clickCount = 1) {
  const p = await point(tabId, args);
  if (!p) return fail("x and y must be normalized 0-1000 coordinates.");
  const button = ["left", "right", "middle"].includes(args.button) ? args.button : "left";
  const count = args.click_count === 2 ? 2 : clickCount;
  try {
    await ensureAttached(tabId);
    await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none", buttons: 0 });
    await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button, buttons: button === "left" ? 1 : button === "right" ? 2 : 4, clickCount: count });
    await sleep(35);
    await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button, buttons: 0, clickCount: count });
    return { ok: true, x: Math.round(p.x), y: Math.round(p.y), button, click_count: count };
  } catch (e) {
    return fail("Could not click at that point: " + (e.message || e));
  }
}

export async function dragPath(tabId, args = {}) {
  const path = Array.isArray(args.path) ? args.path : [];
  if (path.length < 2 || path.length > 50) return fail("path must contain 2–50 normalized points.");
  const points = [];
  for (const item of path) {
    const p = await point(tabId, item);
    if (!p) return fail("Every drag point must be normalized 0-1000 coordinates.");
    points.push(p);
  }
  const duration = Math.min(5000, Math.max(50, Number(args.durationMs) || 400));
  const hold = Math.min(2000, Math.max(0, Number(args.holdMs) || 60));
  try {
    await ensureAttached(tabId);
    await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: points[0].x, y: points[0].y, button: "none", buttons: 0 });
    await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: points[0].x, y: points[0].y, button: "left", buttons: 1, clickCount: 1 });
    await sleep(hold);
    const step = duration / Math.max(1, points.length - 1);
    const started = performance.now();
    for (let i = 1; i < points.length; i++) {
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: points[i].x, y: points[i].y, button: "left", buttons: 1 });
      await sleep(started + step * i - performance.now());
    }
    const last = points[points.length - 1];
    await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: last.x, y: last.y, button: "left", buttons: 0, clickCount: 1 });
    return { ok: true, points: points.length, duration_ms: Math.round(duration) };
  } catch (e) {
    await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: points[0]?.x || 0, y: points[0]?.y || 0, button: "left", buttons: 0, clickCount: 1 }).catch(() => {});
    return fail("Could not drag on the page: " + (e.message || e));
  }
}

export async function scrollAt(tabId, args = {}) {
  const p = await point(tabId, args);
  if (!p) return fail("x and y must be normalized 0-1000 coordinates.");
  const dx = Number(args.deltaX ?? 0);
  const dy = Number(args.deltaY ?? 0);
  if (![dx, dy].every(Number.isFinite) || Math.abs(dx) > 4000 || Math.abs(dy) > 4000) {
    return fail("deltaX and deltaY must be finite numbers within ±4000.");
  }
  try {
    await ensureAttached(tabId);
    await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: dx, deltaY: dy });
    return { ok: true, x: Math.round(p.x), y: Math.round(p.y), deltaX: dx, deltaY: dy };
  } catch (e) {
    return fail("Could not scroll at that point: " + (e.message || e));
  }
}
