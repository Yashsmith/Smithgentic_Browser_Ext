// Local audit + analytics. No network calls. Every run records model usage,
// tool calls, vision/OCR/network/JS activity, errors and timing. Kept bounded
// so a long demo cannot fill chrome.storage.local.

import { AUDIT_KEY, MSG } from "../common/constants.js";

const MAX_RUNS = 20;
const MAX_EVENTS = 300;
const MAX_DETAIL = 16000;
const MAX_TEXT = 2000;

let cache = null;
let writeTimer = null;
let activeRunId = null;
let seq = 0;
const toolStarts = new Map();

function emptyAudit() {
  return {
    version: 1,
    overall: {
      runs: 0,
      completedRuns: 0,
      failedRuns: 0,
      abortedRuns: 0,
      modelCalls: 0,
      toolCalls: 0,
      toolErrors: 0,
      errors: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedTokenCalls: 0,
      visionCalls: 0,
      ocrCalls: 0,
      ocrLines: 0,
      networkReads: 0,
      networkRequests: 0,
      consoleReads: 0,
      consoleMessages: 0,
      jsRuns: 0,
      byTool: {},
      firstAt: null,
      lastAt: null,
    },
    runs: [],
  };
}

export async function loadAudit() {
  if (cache) return cache;
  try {
    const raw = await chrome.storage.local.get(AUDIT_KEY);
    const stored = raw[AUDIT_KEY];
    if (stored && typeof stored === "object") {
      cache = {
        ...emptyAudit(),
        ...stored,
        overall: { ...emptyAudit().overall, ...(stored.overall || {}) },
        runs: Array.isArray(stored.runs) ? stored.runs : [],
      };
      return cache;
    }
  } catch {
    /* fall through to a fresh audit */
  }
  cache = emptyAudit();
  return cache;
}

function persistSoon() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void persist();
  }, 250);
}

export async function persist() {
  if (!cache) return;
  try {
    await chrome.storage.local.set({ [AUDIT_KEY]: cache });
  } catch {
    // Most likely the local-storage quota. Keep the newest half and try once.
    try {
      cache.runs.splice(0, Math.max(1, Math.floor(cache.runs.length / 2)));
      await chrome.storage.local.set({ [AUDIT_KEY]: cache });
    } catch {
      /* logging must never break a run */
    }
  }
}

function clip(value, max = MAX_TEXT) {
  const s = String(value ?? "");
  return s.length > max ? s.slice(0, max) + `… (${s.length - max} more)` : s;
}

export function redactArgs(args = {}) {
  const out = { ...args };
  for (const key of ["text", "value", "content", "code"]) {
    if (key in out) out[key] = `<${String(out[key] ?? "").length} chars redacted>`;
  }
  if (Array.isArray(out.fields)) {
    out.fields = out.fields.slice(0, 50).map((f) => ({
      ...f,
      value: `<${String(f?.value ?? "").length} chars redacted>`,
    }));
  }
  return out;
}

export function sanitizeResult(name, result) {
  if (!result || typeof result !== "object") return result;
  const out = { ...result };
  delete out.image;
  delete out.images;
  if (typeof out.text === "string") out.text = clip(out.text);
  if (Array.isArray(out.lines)) out.lines = out.lines.slice(0, 80);
  if (Array.isArray(out.elements)) {
    out.elementCount = out.elements.length;
    out.elements = out.elements.slice(0, 20).map((e) => ({
      ref: e.ref, tag: e.tag, name: e.name, value: e.value, checked: e.checked, role: e.role,
    }));
  }
  if (Array.isArray(out.targets)) out.targets = out.targets.slice(0, 20);
  if (Array.isArray(out.messages)) out.messages = out.messages.slice(-20);
  if (Array.isArray(out.requests)) out.requests = out.requests.slice(-20);
  return out;
}

function runSummary(run) {
  return {
    id: run.id,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    kind: run.kind,
    provider: run.provider,
    model: run.model,
    promptPreview: run.promptPreview,
    url: run.url,
    title: run.title,
    steps: run.steps,
    modelCalls: run.modelCalls,
    toolCalls: run.toolCalls,
    tokens: run.tokens,
    vision: run.vision,
    ocr: run.ocr,
    network: run.network,
    console: run.console,
    js: run.js,
    errors: run.errors,
    summary: run.summary,
    capabilities: run.capabilities,
  };
}

export async function getAuditSummary() {
  const data = await loadAudit();
  return {
    overall: data.overall,
    runs: data.runs.slice().reverse().map(runSummary),
    activeRunId,
  };
}

export async function getAuditRun(id) {
  const data = await loadAudit();
  const run = data.runs.find((r) => r.id === id);
  return run ? { ...run, timeline: run.timeline.slice(-MAX_EVENTS) } : null;
}

export async function clearAudit() {
  cache = emptyAudit();
  activeRunId = null;
  toolStarts.clear();
  await persist();
}

export async function exportAudit() {
  await loadAudit();
  return JSON.stringify(cache, null, 2);
}

export async function startAuditRun(info = {}) {
  const data = await loadAudit();
  const now = Date.now();
  const run = {
    id: crypto.randomUUID(),
    startedAt: now,
    endedAt: null,
    status: "running",
    kind: info.kind || "chat",
    provider: info.provider || "",
    model: info.model || "",
    promptPreview: clip(info.prompt || "", 300),
    tabId: info.tabId ?? null,
    url: info.url || "",
    title: info.title || "",
    autonomy: info.autonomy || "",
    siteAccess: info.siteAccess || "",
    capabilities: info.capabilities || {},
    steps: 0,
    modelCalls: 0,
    toolCalls: 0,
    tokens: { prompt: 0, completion: 0, total: 0, estimatedCalls: 0 },
    vision: { count: 0, lastAt: null },
    ocr: { count: 0, lines: 0, lastAt: null },
    network: { count: 0, requests: 0, lastAt: null },
    console: { count: 0, messages: 0, lastAt: null },
    js: { count: 0, lastAt: null },
    errors: [],
    summary: "",
    timeline: [],
  };
  data.runs.push(run);
  if (data.runs.length > MAX_RUNS) data.runs.splice(0, data.runs.length - MAX_RUNS);
  data.overall.runs++;
  data.overall.firstAt ||= now;
  data.overall.lastAt = now;
  activeRunId = run.id;
  toolStarts.clear();
  persistSoon();
  broadcast({ kind: "run_start", runId: run.id });
  return run;
}

export async function endAuditRun(status = "completed", extra = {}) {
  const data = await loadAudit();
  const run = data.runs.find((r) => r.id === activeRunId);
  if (!run) return null;
  run.endedAt = Date.now();
  run.status = status;
  if (extra.summary) run.summary = clip(extra.summary, 1000);
  if (extra.steps != null) run.steps = extra.steps;
  if (status === "completed") data.overall.completedRuns++;
  else if (status === "aborted") data.overall.abortedRuns++;
  else data.overall.failedRuns++;
  data.overall.lastAt = run.endedAt;
  activeRunId = null;
  persistSoon();
  broadcast({ kind: "run_end", runId: run.id, status });
  return run;
}

export function setRunSteps(steps) {
  const run = activeRun();
  if (run) run.steps = steps;
}

export async function recordModelEnd(event = {}) {
  const run = activeRun();
  if (!run) return;
  const usage = event.usage || {};
  const prompt = Number(usage.prompt || 0);
  const completion = Number(usage.completion || 0);
  const total = Number(usage.total || prompt + completion);
  const estimated = !!usage.estimated;
  run.modelCalls++;
  run.steps = Math.max(run.steps, Number(event.step) || 0);
  run.tokens.prompt += prompt;
  run.tokens.completion += completion;
  run.tokens.total += total;
  if (estimated) run.tokens.estimatedCalls++;
  const o = cache.overall;
  o.modelCalls++;
  o.promptTokens += prompt;
  o.completionTokens += completion;
  o.totalTokens += total;
  if (estimated) o.estimatedTokenCalls++;
  o.lastAt = Date.now();
  pushEvent(run, {
    kind: "model",
    name: (event.phase === "plan" ? "plan · " : "") + (event.model || run.model),
    ok: event.ok !== false,
    durationMs: event.durationMs || 0,
    summary: `${total} tokens${estimated ? " (estimated)" : ""} · ${event.toolCalls || 0} tool call(s) · ${event.images || 0} image(s)`,
    detail: {
      provider: event.provider || run.provider,
      phase: event.phase || "agent",
      model: event.model || run.model,
      usage: { prompt, completion, total, estimated },
      toolCalls: event.toolCalls || 0,
      images: event.images || 0,
      finishReason: event.finishReason || "",
      contentChars: event.contentChars || 0,
      contentPreview: clip(event.contentPreview || "", 1000),
    },
  });
}

export async function recordToolStart(name, args) {
  if (!activeRun()) return;
  toolStarts.set(name + ":" + (args ? JSON.stringify(args).slice(0, 120) : ""), Date.now());
  // Keep a simple last-start per name too, for tools whose args are large.
  toolStarts.set(name, Date.now());
}

export async function recordToolEnd(event = {}) {
  const run = activeRun();
  if (!run) return;
  const name = event.name || "unknown";
  const started = toolStarts.get(name + ":" + (event.args ? JSON.stringify(event.args).slice(0, 120) : "")) || toolStarts.get(name);
  const durationMs = event.durationMs ?? (started ? Date.now() - started : 0);
  if (started) {
    toolStarts.delete(name);
    toolStarts.delete(name + ":" + (event.args ? JSON.stringify(event.args).slice(0, 120) : ""));
  }
  const ok = event.ok !== false;
  run.toolCalls++;
  const o = cache.overall;
  o.toolCalls++;
  o.byTool[name] = (o.byTool[name] || 0) + 1;
  if (!ok) o.toolErrors++;
  o.lastAt = Date.now();

  if (name === "take_screenshot" || name === "inspect_region") {
    run.vision.count++;
    run.vision.lastAt = Date.now();
    o.visionCalls++;
  }
  if (name === "read_image_text") {
    const lines = Number(event.detail?.lineCount ?? (Array.isArray(event.detail?.lines) ? event.detail.lines.length : event.detail?.lines)) || 0;
    run.ocr.count++;
    run.ocr.lines += lines;
    run.ocr.lastAt = Date.now();
    o.ocrCalls++;
    o.ocrLines += lines;
  }
  if (name === "read_network") {
    const reqs = event.detail?.requests;
    const count = Number(Array.isArray(reqs) ? reqs.length : reqs ?? event.detail?.count ?? 0);
    run.network.count++;
    run.network.requests += count;
    run.network.lastAt = Date.now();
    o.networkReads++;
    o.networkRequests += count;
  }
  if (name === "read_console") {
    const msgs = event.detail?.messages;
    const count = Number(Array.isArray(msgs) ? msgs.length : msgs ?? event.detail?.count ?? 0);
    run.console.count++;
    run.console.messages += count;
    run.console.lastAt = Date.now();
    o.consoleReads++;
    o.consoleMessages += count;
  }
  if (name === "run_javascript") {
    run.js.count++;
    run.js.lastAt = Date.now();
    o.jsRuns++;
  }

  const summary = clip(event.summary || (ok ? "done" : event.error || "failed"), 500);
  pushEvent(run, {
    kind: event.kind || "tool",
    name,
    ok,
    durationMs,
    summary,
    detail: {
      args: redactArgs(event.args || {}),
      result: sanitizeResult(name, event.detail || {}),
    },
  });
}

export async function recordError(message, source = "agent") {
  const run = activeRun();
  if (!run) return;
  run.errors.push({ at: Date.now(), source, message: clip(message, 1000) });
  cache.overall.errors++;
  cache.overall.lastAt = Date.now();
  pushEvent(run, { kind: "error", name: source, ok: false, summary: clip(message, 500) });
}

export async function recordWarning(message) {
  const run = activeRun();
  if (!run) return;
  pushEvent(run, { kind: "warning", name: "warning", ok: true, summary: clip(message, 500) });
}

export async function recordFinish(summary) {
  const run = activeRun();
  if (!run) return;
  if (summary) run.summary = clip(summary, 1000);
  pushEvent(run, { kind: "finish", name: "finish", ok: true, summary: clip(summary || "done", 500) });
  await persist();
}

function activeRun() {
  if (!cache || !activeRunId) return null;
  return cache.runs.find((r) => r.id === activeRunId) || null;
}

function pushEvent(run, event) {
  if (!run) return;
  let detail = event.detail || null;
  if (detail) {
    try {
      const raw = JSON.stringify(detail);
      if (raw.length > MAX_DETAIL) detail = { truncated: true, preview: raw.slice(0, MAX_DETAIL) };
    } catch {
      detail = { unavailable: true };
    }
  }
  const entry = {
    id: ++seq,
    at: Date.now(),
    kind: event.kind || "event",
    name: event.name || "",
    ok: event.ok !== false,
    durationMs: event.durationMs || 0,
    summary: clip(event.summary || "", 800),
    detail,
  };
  run.timeline.push(entry);
  if (run.timeline.length > MAX_EVENTS) run.timeline.splice(0, run.timeline.length - MAX_EVENTS);
  persistSoon();
  broadcast({ kind: "event", runId: run.id, event: entry });
}

function broadcast(payload) {
  try {
    chrome.runtime.sendMessage({ type: MSG.AUDIT_EVENT, ...payload }).catch(() => {});
  } catch {
    /* no receiver */
  }
}
