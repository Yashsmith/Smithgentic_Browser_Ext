/** Bounds and centers are relative to the returned image, including inspected crops. */
export function normalizedBox(rect, region) {
  const left = Math.max(rect.x, region.x);
  const top = Math.max(rect.y, region.y);
  const right = Math.min(rect.x + rect.width, region.x + region.width);
  const bottom = Math.min(rect.y + rect.height, region.y + region.height);
  if (right <= left || bottom <= top) return null;
  const nx = (x) => Math.round((x - region.x) / region.width * 1000);
  const ny = (y) => Math.round((y - region.y) / region.height * 1000);
  return {
    x: nx((left + right) / 2), y: ny((top + bottom) / 2),
    bounds: { x: nx(left), y: ny(top), width: nx(right) - nx(left), height: ny(bottom) - ny(top) },
  };
}

// Serialized into the page; keep dependencies explicit and the output bounded.
export function readVisualTargets(region, interactiveElements, box, elements = null) {
  const refs = new Map(interactiveElements.map((el, i) => [el, i + 1]));
  const targets = [];
  let scanned = 0;
  let truncated = false;
  for (const el of elements || document.querySelectorAll('body *')) {
    if (++scanned > 5000 || targets.length >= 160) { truncated = true; break; }
    if (el.closest('script, style, noscript, [hidden], [inert], [data-smithgentic-browser-pointer]')) continue;
    const ref = refs.get(el);
    const raster = ['IMG', 'CANVAS'].includes(el.tagName);
    if (!ref && !raster && el.children.length) continue;
    const style = bcStyle(el);
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) continue;
    const rect = bcRect(el);
    if (!rect) continue;
    const position = box({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }, region);
    if (!position) continue;
    const hit = bcHitTest(el,
      region.x + position.x * region.width / 1000,
      region.y + position.y * region.height / 1000);
    if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) continue;
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => bcById(el, id)?.textContent || '').join(' ').trim();
    const text = (labelledBy || el.getAttribute('aria-label') || el.alt || el.placeholder
      || Array.from(el.labels || []).map(label => label.innerText).join(' ')
      || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!text && !ref && !raster) continue;
    targets.push({
      ...(ref ? { ref } : {}), text,
      kind: el.getAttribute('role') || el.tagName.toLowerCase(),
      ...position,
      ...(el.draggable ? { draggable: true } : {}),
    });
  }
  return { targets, truncated };
}

export function normalizeOcrLines(blocks, width, height) {
  const lines = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const text = String(line.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        const b = line.bbox;
        if (!text || !b || line.confidence < 40) continue;
        const position = normalizedBox({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 },
          { x: 0, y: 0, width, height });
        if (position) lines.push({ text, confidence: Math.round(line.confidence), ...position });
        if (lines.length >= 160) return { lines, truncated: true };
      }
    }
  }
  return { lines, truncated: false };
}
