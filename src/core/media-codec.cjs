'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function imageType(bytes) {
  if (!bytes || bytes.length < 12) return '';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (bytes.subarray(4, 8).toString() === 'ftyp') {
    const brands = bytes.subarray(8, 48).toString();
    if (/avif|avis/.test(brands)) return 'image/avif';
    if (/heic|heix|hevc|hevx|mif1|msf1/.test(brands)) return 'image/heic';
  }
  return '';
}
function isWxgf(bytes) { return bytes.subarray(0, 4).toString('ascii') === 'wxgf'; }
function candidateKeys(accountDir, selfId, appData) {
  const base = appData || path.join(os.homedir(), 'Library/Containers/com.tencent.xinWeChat/Data/Documents/app_data');
  const codes = new Set();
  for (const sub of ['net/kvcomm', 'ilink/kvcomm']) {
    let names; try { names = fs.readdirSync(path.join(base, sub)); } catch { continue; }
    for (const name of names) { const match = /^key_(\d+)_.*\.statistic$/.exec(name); if (match) codes.add(match[1]); }
  }
  // Compatibility derivation, independently validated against the local image
  // format. See the included acmerfight MIT reference; no key is logged/saved.
  const ids = [...new Set([selfId, path.basename(accountDir)].filter(Boolean))];
  const candidates = [];
  for (const code of codes) for (const id of ids) candidates.push({
    key: Buffer.from(crypto.createHash('md5').update(code + id).digest('hex').slice(0, 16), 'ascii'), xor: Number(BigInt(code) & 255n)
  });
  return candidates;
}
function datParts(bytes, key, xor) {
  if (bytes.length < 15) throw new Error('图片数据不完整');
  const aesSize = bytes.readUInt32LE(6), xorSize = bytes.readUInt32LE(10);
  const padded = aesSize ? aesSize + 16 - aesSize % 16 : 0;
  if (15 + padded + xorSize > bytes.length || aesSize > 64 * 1024 * 1024) throw new Error('图片长度无效');
  let first = Buffer.alloc(0);
  if (padded) {
    const cipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    first = Buffer.concat([cipher.update(bytes.subarray(15, 15 + padded)), cipher.final()]);
    if (first.length !== aesSize) throw new Error('图片填充校验未通过');
  }
  const tail = bytes.subarray(15 + padded), unchanged = tail.subarray(0, tail.length - xorSize);
  const last = Buffer.from(tail.subarray(tail.length - xorSize));
  for (let i = 0; i < last.length; i++) last[i] ^= xor;
  return Buffer.concat([first, unchanged, last]);
}
function decodeDat(bytes, candidates) {
  if (imageType(bytes) || isWxgf(bytes)) return Buffer.from(bytes);
  const signature = bytes.subarray(0, 6).toString('hex');
  if (signature === '070856320807' || signature === '070856310807') {
    let tries = candidates;
    if (signature === '070856310807') {
      const possible = new Set(candidates.map(k => k.xor));
      if (bytes.length > 2 && (bytes[bytes.length - 1] ^ 0xd9) === (bytes[bytes.length - 2] ^ 0xff)) possible.add(bytes[bytes.length - 1] ^ 0xd9);
      tries = [...possible].map(xor => ({ key: Buffer.from('cfcd208495d565ef', 'ascii'), xor }));
    }
    for (const item of tries) {
      try { const plain = datParts(bytes, item.key, item.xor); if (imageType(plain) || isWxgf(plain)) return plain; } catch {}
    }
    throw new Error('此图片的本机解码参数尚未匹配');
  }
  for (const magic of [0xff, 0x89, 0x47, 0x52]) {
    const xor = bytes[0] ^ magic, first = Buffer.from(bytes.subarray(0, 16));
    for (let i = 0; i < first.length; i++) first[i] ^= xor;
    if (!imageType(first)) continue;
    return Buffer.from(bytes.map(b => b ^ xor));
  }
  throw new Error('暂不支持此本机图片格式');
}
async function unwrapWxgf(bytes, ffmpeg) {
  if (!isWxgf(bytes)) return { data: bytes, firstFrameOnly: false };
  const starts = [bytes.indexOf(Buffer.from('0000000140', 'hex')), bytes.indexOf(Buffer.from('00000140', 'hex'))].filter(n => n >= 0);
  if (!starts.length || !ffmpeg || !fs.existsSync(ffmpeg)) throw new Error('WXGF 图片的本机视频解码器不可用');
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'hevc', '-i', 'pipe:0', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = []; let total = 0, finished = false;
    const timeout = setTimeout(() => { child.kill(); finish(new Error('图片解码超时')); }, 30000);
    function finish(error, result) { if (finished) return; finished = true; clearTimeout(timeout); error ? reject(error) : resolve(result); }
    child.stdout.on('data', chunk => { total += chunk.length; if (total > 64 * 1024 * 1024) { child.kill(); finish(new Error('解码图片过大')); } else chunks.push(chunk); });
    child.on('error', () => finish(new Error('无法启动本机图片解码器')));
    child.on('exit', code => { const data = Buffer.concat(chunks); code === 0 && imageType(data) ? finish(null, { data, firstFrameOnly: true }) : finish(new Error('WXGF 图片解码失败')); });
    child.stdin.on('error', () => {}); child.stdin.end(bytes.subarray(Math.min(...starts)));
  });
}
module.exports = { imageType, isWxgf, candidateKeys, datParts, decodeDat, unwrapWxgf };
