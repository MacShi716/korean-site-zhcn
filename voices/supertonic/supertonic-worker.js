/* Supertonic 3 Korean TTS worker (sherpa-onnx wasm 2.0.2).
   Models are fetched on demand from ./models/ (relative), cached, then
   written into the WASM filesystem. The official 145MB .data pack is not used. */
const MODEL_FILES = [
  'duration_predictor.int8.onnx',
  'text_encoder.int8.onnx',
  'tts.json',
  'unicode_indexer.bin',
  'vector_estimator.int8.onnx',
  'vocoder.int8.onnx',
  'voice.bin'
];
const CACHE_NAME = 'korean-site-voices-supertonic-v1';

let tts = null;
let runtimeReady = null;
let runtimeReadyResolve = null;
runtimeReady = new Promise((resolve, reject) => { runtimeReadyResolve = {resolve, reject}; });

function workerBase() {
  try { return new URL('./', self.location.href).href; } catch (e) { return './'; }
}
function modelUrl(name) { return new URL('models/' + name, workerBase()).href; }

self.Module = {
  locateFile: function (path, scriptDirectory) {
    return new URL(path, scriptDirectory || workerBase()).href;
  },
  setStatus: function (status) {
    self.postMessage({ type: 'sherpa-onnx-tts-progress', status: status || '' });
  },
  onRuntimeInitialized: function () {
    runtimeReadyResolve.resolve();
  }
};

importScripts('sherpa-onnx-wasm-main-tts.js');
importScripts('sherpa-onnx-tts.js');

function getErrorMessage(err) {
  if (err instanceof Error) return err.stack ? (err.message + '\n' + err.stack) : err.message;
  return String(err);
}

async function cachedArrayBuffer(url, onProgress) {
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); } catch (e) { cache = null; }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  }
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('fetch ' + url + ' failed: ' + res.status);
  const total = Number(res.headers.get('Content-Length') || 0);
  if (!res.body || !onProgress) {
    const buf = await res.arrayBuffer();
    if (cache) { try { await cache.put(url, new Response(buf.slice(0), res)); } catch (e) {} }
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  if (cache) { try { await cache.put(url, new Response(out, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (e) {} }
  return out.buffer;
}

async function ensureTts(onProgress) {
  if (tts) return tts;
  await runtimeReady;
    for (let i = 0; i < MODEL_FILES.length; i++) {
    const name = MODEL_FILES[i];
    const buf = await cachedArrayBuffer(modelUrl(name), function (loaded, total) {
      if (onProgress) onProgress({ file: name, index: i, count: MODEL_FILES.length, loaded: loaded, total: total });
    });
    const bytes = new Uint8Array(buf);
    if (typeof self.Module.FS_createDataFile === 'function') {
      try { self.Module.FS_unlink('/' + name); } catch (e) {}
      self.Module.FS_createDataFile('/', name, bytes, true, true, true);
    } else if (FS && FS.writeFile) {
      FS.writeFile(name, bytes);
    } else {
      throw new Error('no filesystem API to install ' + name);
    }
  }
  tts = createOfflineTts(self.Module);
  return tts;
}

self.onmessage = async function (e) {
  const data = e.data || {};
  const type = data.type;
  try {
    if (type === 'init') {
      await ensureTts(function (p) { self.postMessage({ type: 'sherpa-onnx-tts-progress', progress: p }); });
      self.postMessage({
        type: 'sherpa-onnx-tts-ready',
        modelType: getDefaultOfflineTtsModelType(),
        numSpeakers: tts.numSpeakers,
        sampleRate: tts.sampleRate,
        lang: tts.lang || ''
      });
      return;
    }
    if (type === 'generate' || type === 'generateWithConfig') {
      await ensureTts(function (p) { self.postMessage({ type: 'sherpa-onnx-tts-progress', progress: p }); });
      const genConfig = Object.assign({
        sid: data.sid || 0,
        speed: data.speed || 1.0,
        numSteps: 8,
        extra: { lang: 'ko' }
      }, data.genConfig || {});
      if (!genConfig.extra) genConfig.extra = { lang: 'ko' };
      if (!genConfig.extra.lang) genConfig.extra.lang = 'ko';
      genConfig.callback = function (samples, n, progress) {
        self.postMessage({ type: 'sherpa-onnx-tts-generation-progress', progress: progress });
        return 1;
      };
      const audio = tts.generateWithConfig(data.text || '', genConfig);
      if (!audio || !audio.samples || !audio.samples.length) {
        throw new Error('empty audio');
      }
      const samples = audio.samples;
      self.postMessage({ type: 'sherpa-onnx-tts-result', samples: samples, sampleRate: audio.sampleRate || tts.sampleRate }, [samples.buffer]);
      return;
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: getErrorMessage(err) });
  }
};
