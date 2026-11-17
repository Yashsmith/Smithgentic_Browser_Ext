import { copyFile, mkdir, readdir } from 'node:fs/promises';

// MV3 must execute packaged code. No runtime CDN or language-model downloads.
const root = new URL('../', import.meta.url);
const destination = new URL('extension/vendor/ocr/', root);
await mkdir(destination, { recursive: true });
const copy = (from, to) => copyFile(new URL(`node_modules/${from}`, root), new URL(to, destination));
await Promise.all([
  copy('tesseract.js/dist/tesseract.esm.min.js', 'tesseract.esm.min.js'),
  copy('tesseract.js/dist/worker.min.js', 'worker.min.js'),
  copy('tesseract.js/dist/worker.min.js.LICENSE.txt', 'worker.LICENSE.txt'),
  copy('tesseract.js/LICENSE.md', 'tesseract.LICENSE'),
  copy('tesseract.js/dist/tesseract.min.js.LICENSE.txt', 'tesseract-bundle.LICENSE.txt'),
  copy('tesseract.js-core/LICENSE', 'core.LICENSE'),
  copy('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'),
  ...(await readdir(new URL('node_modules/tesseract.js-core/', root)))
    .filter(name => /-lstm\.wasm(\.js)?$/.test(name))
    .map(name => copy(`tesseract.js-core/${name}`, name)),
]);
