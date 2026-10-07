// Production-only dependency smoke check, also run as the image's non-root
// user. No application/database boot, network, files selected by SVG or mail.
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { SaxesParser } from "saxes";

const require = createRequire(import.meta.url);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><path fill="#c20" d="M1 1h20v10H1z"/></svg>';
new SaxesParser({ xmlns: true }).write(svg).close();
const worker = new Worker(`
  const { parentPort, workerData } = require("node:worker_threads");
  const { readFileSync } = require("node:fs");
  (async () => {
    const { initWasm, Resvg } = require(workerData.modulePath);
    await initWasm(readFileSync(workerData.wasmPath));
    const renderer = new Resvg(workerData.svg, { font: { loadSystemFonts: false }, fitTo: { mode: "zoom", value: 3.125 } });
    const image = renderer.render();
    parentPort.postMessage({ png: image.asPng(), width: image.width, height: image.height });
    image.free(); renderer.free();
  })().catch(() => { process.exitCode = 1; });
`, {
  eval: true,
  execArgv: [],
  workerData: {
    svg, modulePath: require.resolve("@resvg/resvg-wasm"),
    wasmPath: require.resolve("@resvg/resvg-wasm/index_bg.wasm"),
  },
  resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
});
let timer;
try {
  await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("SVG runtime smoke conversion timed out")), 10_000);
    worker.once("message", ({ png, width, height }) => {
      if (width !== 75 || height < 37 || height > 38 ||
          !Buffer.from(png).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        reject(new Error("SVG runtime smoke produced invalid output"));
      } else resolve();
    });
    worker.once("error", () => reject(new Error("SVG runtime smoke worker failed")));
    worker.once("exit", () => reject(new Error("SVG runtime smoke worker exited without output")));
  });
  console.log("SVG runtime smoke passed (production WASM, isolated worker, PNG)");
} finally {
  clearTimeout(timer);
  await worker.terminate();
}
