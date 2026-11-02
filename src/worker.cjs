'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const C = require('./core/common.cjs');
async function execute({ action, value, profile, config, rawKey }) {
  if (action === 'inspect') return require('./core/import.cjs').inspect(value.path);
  if (action === 'synchronize') return require('./core/import.cjs').synchronize(profile, { ...(config.source || config), force: Boolean(value?.force) }, rawKey ? Buffer.from(rawKey) : null, progress => parentPort?.postMessage({ progress }));
  if (action === 'media') return require('./core/media.cjs').resolve(profile, config, value);
  const manifest = C.json(path.join(profile, 'current.json'));
  if (!manifest.index || !fs.existsSync(manifest.index)) throw new Error('IMPORT_FIRST');
  const { Store } = require('./core/store.cjs'), store = new Store(manifest.index);
  try {
    if (action === 'export') {
      const output = value.output;
      if (!output || typeof output !== 'string') throw new Error('EXPORT_DESTINATION_MISSING');
      const temporary = output + '.grouppulse.tmp';
      const result = require('./core/export.cjs').plan(store, value);
      try { fs.writeFileSync(temporary, result.content, { mode: 0o600 }); fs.renameSync(temporary, output); }
      catch(error){ fs.rmSync(temporary,{force:true});throw error; }
      return { exported: true, records: result.records };
    }
    const allowed = new Set(['status', 'threads', 'messages', 'message', 'contacts', 'moments', 'resources', 'statistics', 'dashboard', 'market', 'prices', 'evidence']);
    if (!allowed.has(action)) throw new Error('ACTION_NOT_ALLOWED');
    return store[action](value);
  } finally { store.close(); }
}
if (parentPort) execute(workerData).then(result => parentPort.postMessage({ result })).catch(error => parentPort.postMessage({ error: error.message }));
module.exports = { execute };
