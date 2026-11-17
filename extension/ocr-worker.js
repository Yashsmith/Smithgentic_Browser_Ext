import Tesseract from './vendor/ocr/tesseract.esm.min.js';
import { normalizeOcrLines } from './observation.js';

let workerPromise;
let queue = Promise.resolve();

async function recognize(message) {
  workerPromise ??= Tesseract.createWorker('eng', 1, {
    workerPath: chrome.runtime.getURL('vendor/ocr/worker.min.js'),
    corePath: chrome.runtime.getURL('vendor/ocr'),
    langPath: chrome.runtime.getURL('vendor/ocr'),
    workerBlobURL: false,
    cacheMethod: 'none',
    errorHandler: () => {},
  });
  try {
    const worker = await workerPromise;
    const { data } = await worker.recognize(message.image, { tessedit_pageseg_mode: '11' }, { text: true, blocks: true });
    return { status: 'ok', language: 'eng', ...normalizeOcrLines(data.blocks, message.width, message.height) };
  } catch (error) {
    const failed = workerPromise;
    workerPromise = null;
    await failed?.then(worker => worker.terminate()).catch(() => {});
    return { status: 'error', message: error.message, lines: [] };
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'smithgentic-browser-ocr' || sender.id !== chrome.runtime.id) return;
  queue = queue.then(() => recognize(message));
  queue.then(respond, error => respond({ status: 'error', message: error.message, lines: [] }));
  return true;
});
