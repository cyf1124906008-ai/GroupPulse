'use strict';
// ISAAC-64, based on Bob Jenkins' public-domain algorithm specification:
// https://burtleburtle.net/bob/c/isaac64.c (1996, Public Domain).
// This implementation does not embed an application-specific WASM/runtime.
const U64 = value => BigInt.asUintN(64, value);
function scramble(v) {
  v[0] -= v[4]; v[5] ^= v[7] >> 9n; v[7] += v[0];
  v[1] -= v[5]; v[6] ^= v[0] << 9n; v[0] += v[1];
  v[2] -= v[6]; v[7] ^= v[1] >> 23n; v[1] += v[2];
  v[3] -= v[7]; v[0] ^= v[2] << 15n; v[2] += v[3];
  v[4] -= v[0]; v[1] ^= v[3] >> 14n; v[3] += v[4];
  v[5] -= v[1]; v[2] ^= v[4] << 20n; v[4] += v[5];
  v[6] -= v[2]; v[3] ^= v[5] >> 17n; v[5] += v[6];
  v[7] -= v[3]; v[4] ^= v[6] << 14n; v[6] += v[7];
}
class Isaac {
  constructor(seed = '0') {
    if (!/^\d{1,20}$/.test(String(seed)) || BigInt(seed) > 0xffffffffffffffffn) throw new Error('INVALID_MEDIA_SEED');
    this.memory = new BigUint64Array(256); this.output = new BigUint64Array(256);
    this.output[0] = BigInt(seed); this.a = 0n; this.b = 0n; this.counter = 0n;
    const work = new BigUint64Array(8).fill(0x9e3779b97f4a7c13n);
    for (let turn = 0; turn < 4; turn++) scramble(work);
    for (let pass = 0; pass < 2; pass++) for (let at = 0; at < 256; at += 8) {
      for (let j = 0; j < 8; j++) work[j] += (pass ? this.memory : this.output)[at + j];
      scramble(work); this.memory.set(work, at);
    }
    this.refill(); this.position = 0; this.pending = Buffer.alloc(0);
  }
  refill() {
    let a = this.a, b = U64(this.b + ++this.counter);
    for (let at = 0; at < 256; at++) {
      const x = this.memory[at];
      switch (at % 4) {
        case 0: a = U64(~(a ^ (a << 21n))); break;
        case 1: a = U64(a ^ (a >> 5n)); break;
        case 2: a = U64(a ^ (a << 12n)); break;
        default: a = U64(a ^ (a >> 33n));
      }
      a = U64(a + this.memory[(at + 128) % 256]);
      const y = U64(this.memory[Number((x >> 3n) & 255n)] + a + b);
      this.memory[at] = y;
      b = U64(this.memory[Number((y >> 11n) & 255n)] + x); this.output[at] = b;
    }
    this.a = a; this.b = b;
  }
  bytes(length) {
    const buffer = Buffer.alloc(length);
    for (let at = 0; at < length;) {
      if (!this.pending.length) {
        if (this.position === 256) { this.refill(); this.position = 0; }
        this.pending = Buffer.alloc(8); this.pending.writeBigUInt64BE(this.output[255 - this.position++]);
      }
      const size = Math.min(this.pending.length, length - at); this.pending.copy(buffer, at, 0, size); at += size; this.pending = this.pending.subarray(size);
    }
    return buffer;
  }
}
module.exports = { Isaac };
