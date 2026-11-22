const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

//参考字形库：Source Han Sans SC Normal（与超星 font-cxsecret 同源）
const DB_PATH = path.join(__dirname, 'chaoxing-font-db.bin.gz');
const CHARS_PATH = path.join(__dirname, 'chaoxing-font-chars.txt');
const BYTES_PER_SIG = 288; // 48 * 48 / 8

let cache = null;

//16 位 popcount 查找表
const POP16 = new Uint8Array(65536);
for (let i = 1; i < 65536; i++) { POP16[i] = POP16[i >> 1] + (i & 1); }

function loadDb(){
    if (cache) { return cache; }
    const raw = zlib.gunzipSync(fs.readFileSync(DB_PATH));
    const chars = fs.readFileSync(CHARS_PATH, 'utf8');
    const count = raw.length / BYTES_PER_SIG;
    const offsets = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    const words = new Uint16Array(count * 144);
    words.set(offsets.subarray(0, count * 144));
    const sigCount = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
        let c = 0;
        const base = i * 144;
        for (let j = 0; j < 144; j++) { c += POP16[words[base + j]]; }
        sigCount[i] = c;
    }
    cache = { chars, words, sigCount, count };
    return cache;
}

//读取 TTF cmap（format 4 / 12），返回字体里实际包含的字符
function readCmapChars(buffer){
    if (!buffer || buffer.length < 12) { return []; }
    const numTables = buffer.readUInt16BE(4);
    let cmapOffset = 0;
    for (let i = 0; i < numTables; i++) {
        const off = 12 + i * 16;
        if (buffer.toString('ascii', off, off + 4) === 'cmap') {
            cmapOffset = buffer.readUInt32BE(off + 8);
            break;
        }
    }
    if (!cmapOffset) { return []; }

    const subCount = buffer.readUInt16BE(cmapOffset + 2);
    let sub = 0;
    for (let i = 0; i < subCount; i++) {
        const platform = buffer.readUInt16BE(cmapOffset + 4 + i * 8);
        const encoding = buffer.readUInt16BE(cmapOffset + 6 + i * 8);
        const offset = buffer.readUInt32BE(cmapOffset + 8 + i * 8);
        if ((platform === 3 && encoding === 1) || platform === 0) {
            sub = cmapOffset + offset;
        }
    }
    if (!sub) { sub = cmapOffset + buffer.readUInt32BE(cmapOffset + 8); }

    const codes = [];
    const format = buffer.readUInt16BE(sub);
    if (format === 4) {
        const segX2 = buffer.readUInt16BE(sub + 6);
        const seg = segX2 / 2;
        const endBase = sub + 14;
        const startBase = endBase + segX2 + 2;
        const deltaBase = startBase + segX2;
        const rangeBase = deltaBase + segX2;
        for (let i = 0; i < seg; i++) {
            const end = buffer.readUInt16BE(endBase + i * 2);
            const start = buffer.readUInt16BE(startBase + i * 2);
            const delta = buffer.readInt16BE(deltaBase + i * 2);
            const rangeOffset = buffer.readUInt16BE(rangeBase + i * 2);
            if (start === 0xffff) { continue; }
            for (let cp = start; cp <= end; cp++) {
                let gid;
                if (rangeOffset === 0) {
                    gid = (cp + delta) & 0xffff;
                } else {
                    const addr = rangeBase + i * 2 + rangeOffset + (cp - start) * 2;
                    gid = buffer.readUInt16BE(addr);
                    if (gid !== 0) { gid = (gid + delta) & 0xffff; }
                }
                if (gid !== 0) { codes.push(cp); }
            }
        }
    } else if (format === 12) {
        const groups = buffer.readUInt32BE(sub + 12);
        for (let i = 0; i < groups; i++) {
            const off = sub + 16 + i * 12;
            const start = buffer.readUInt32BE(off);
            const end = buffer.readUInt32BE(off + 4);
            const gid = buffer.readUInt32BE(off + 8);
            if (gid === 0) { continue; }
            for (let cp = start; cp <= end && cp < 0x110000; cp++) { codes.push(cp); }
        }
    }
    return codes.map(cp => String.fromCodePoint(cp));
}

//在页面里用 font-cxsecret 渲染字符，返回 48x48 位图（288 字节 base64）
async function renderSignatures(frame, fontBase64, chars){
    return frame.evaluate(async (charList) => {
        try { await document.fonts.load('128px font-cxsecret'); } catch (e) {}
        await document.fonts.ready;

        const S = 128;
        const N = 48;
        const BYTES = 288;

        function render(ch) {
            const c = document.createElement('canvas');
            c.width = c.height = S;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.clearRect(0, 0, S, S);
            ctx.fillStyle = '#000';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            ctx.font = `${Math.floor(S * 0.8)}px 'font-cxsecret'`;
            ctx.fillText(ch, S / 2, S / 2);
            const data = ctx.getImageData(0, 0, S, S).data;
            let minX = S, minY = S, maxX = -1, maxY = -1;
            for (let y = 0; y < S; y++) {
                for (let x = 0; x < S; x++) {
                    if (data[(y * S + x) * 4 + 3] > 32) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            if (maxX < 0) { return null; }
            const w = maxX - minX + 1;
            const h = maxY - minY + 1;
            const c2 = document.createElement('canvas');
            c2.width = c2.height = N;
            const ctx2 = c2.getContext('2d', { willReadFrequently: true });
            ctx2.fillStyle = '#fff';
            ctx2.fillRect(0, 0, N, N);
            ctx2.drawImage(c, minX, minY, w, h, 0, 0, N, N);
            const d2 = ctx2.getImageData(0, 0, N, N).data;
            const bytes = new Uint8Array(BYTES);
            for (let i = 0; i < N * N; i++) {
                if (d2[i * 4] < 128) { bytes[i >> 3] |= 0x80 >> (i & 7); }
            }
            let binary = '';
            for (let i = 0; i < bytes.length; i++) { binary += String.fromCharCode(bytes[i]); }
            return btoa(binary);
        }

        return charList.map(ch => ({ ch, data: render(ch) }));
    }, chars);
}

//把页面里的混淆字符映射成真实字符
async function buildMapping(frame, fontBase64, chars){
    const db = loadDb();
    const buffer = Buffer.from(fontBase64, 'base64');
    const cmapChars = new Set(readCmapChars(buffer));
    const secretChars = [...new Set(chars)].filter(ch => cmapChars.has(ch));
    if (!secretChars.length) { return {}; }

    const rendered = await renderSignatures(frame, fontBase64, secretChars);
    const mapping = {};
    const charIndex = new Map();
    for (let i = 0; i < db.chars.length; i++) { charIndex.set(db.chars[i], i); }

    for (const item of rendered) {
        if (!item.data) { continue; }
        const bytes = Buffer.from(item.data, 'base64');
        const sig = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
        let sigCount = 0;
        for (let i = 0; i < 144; i++) { sigCount += POP16[sig[i]]; }

        let best = -1, bestScore = -1, second = -1, secondScore = -1;
        for (let i = 0; i < db.count; i++) {
            let inter = 0;
            const base = i * 144;
            for (let j = 0; j < 144; j++) { inter += POP16[sig[j] & db.words[base + j]]; }
            const union = sigCount + db.sigCount[i] - inter;
            const score = union ? inter / union : 0;
            if (score > bestScore) {
                second = best; secondScore = bestScore;
                best = i; bestScore = score;
            } else if (score > secondScore) {
                second = i; secondScore = score;
            }
        }
        if (best >= 0) {
            mapping[item.ch] = {
                char: db.chars[best],
                score: Math.round(bestScore * 1000) / 1000,
                second: second >= 0 ? db.chars[second] : '',
                secondScore: Math.round(secondScore * 1000) / 1000,
            };
        }
    }
    return mapping;
}

function decodeText(text, mapping){
    let out = '';
    for (const ch of text) { out += mapping[ch] ? mapping[ch].char : ch; }
    return out;
}

module.exports = { buildMapping, decodeText, loadDb, readCmapChars };
