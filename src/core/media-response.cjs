'use strict';
const fs = require('node:fs');
const { Readable } = require('node:stream');
// Single byte ranges let Chromium seek in local videos without reading the entire file.
function respond(file, type, request, firstFrameOnly = false) {
  const size = fs.statSync(file).size;
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'X-GroupPulse-First-Frame': String(firstFrameOnly) };
  let start = 0, end = size - 1, status = 200;
  const range = request.headers.get('Range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || !match[1] && !match[2]) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  return new Response(request.method === 'HEAD' || size === 0 ? null : Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers });
}
module.exports = { respond };
