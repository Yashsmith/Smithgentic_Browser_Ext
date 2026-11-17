let creating;

export async function recognizeScreenshot(shot, format, api = chrome) {
  let timeout;
  try {
    const url = api.runtime.getURL('ocr.html');
    const contexts = await api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (!contexts.length) {
      creating ??= api.offscreen.createDocument({
        url: 'ocr.html', reasons: ['WORKERS'],
        justification: 'Read screenshot text locally with the packaged OCR worker.',
      }).finally(() => { creating = null; });
      await creating;
    }
    return await Promise.race([
      api.runtime.sendMessage({
        target: 'smithgentic-browser-ocr', image: `data:image/${format};base64,${shot.data}`,
        width: shot.width, height: shot.height,
      }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Local OCR timed out')), 8000); }),
    ]);
  } catch (error) {
    // A failed/hung worker must not slow subsequent screenshots or retain the image.
    await api.offscreen.closeDocument().catch(() => {});
    return { status: 'error', message: error.message, lines: [] };
  } finally {
    clearTimeout(timeout);
  }
}
