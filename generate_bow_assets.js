const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height, pixelFn) {
    const rawData = Buffer.alloc(height * (1 + width * 4));
    let offset = 0;
    for (let y = 0; y < height; y++) {
        rawData[offset++] = 0;
        for (let x = 0; x < width; x++) {
            const [r, g, b, a] = pixelFn(x, y);
            rawData[offset++] = r;
            rawData[offset++] = g;
            rawData[offset++] = b;
            rawData[offset++] = a;
        }
    }
    const compressed = zlib.deflateSync(rawData);

    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[i] = c;
    }

    function crc32(buf) {
        let crc = 0 ^ (-1);
        for (let i = 0; i < buf.length; i++) {
            crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
        }
        return (crc ^ (-1)) >>> 0;
    }

    function chunk(type, data) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const t = Buffer.from(type, 'ascii');
        const crcBuf = Buffer.alloc(4);
        crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
        return Buffer.concat([len, t, data, crcBuf]);
    }

    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function generateItemBow(scale, isGolden) {
    const frameW = 16 * scale;
    const frameH = 16 * scale;
    const totalW = frameW * 6;
    const totalH = frameH;

    const woodDark = isGolden ? [180, 120, 10, 255] : [100, 50, 15, 255];
    const woodMid = isGolden ? [235, 180, 20, 255] : [155, 85, 25, 255];
    const woodLight = isGolden ? [255, 230, 80, 255] : [210, 135, 50, 255];
    const stringColor = isGolden ? [255, 250, 210, 240] : [230, 230, 230, 220];
    const arrowShaft = isGolden ? [240, 200, 80, 255] : [180, 140, 90, 255];
    const arrowTip = isGolden ? [255, 255, 255, 255] : [200, 215, 230, 255];
    const arrowFeather = isGolden ? [230, 70, 70, 255] : [220, 220, 220, 255];
    const transparent = [0, 0, 0, 0];

    return createPng(totalW, totalH, (x, y) => {
        const frame = Math.floor(x / frameW);
        const fx = Math.floor((x % frameW) / scale);
        const fy = Math.floor(y / scale);

        const yOffset = (frame === 1 || frame === 5) ? 1 : ((frame === 2 || frame === 4) ? 2 : 0);
        const py = fy - yOffset;

        const isArcBody = (
            (fx === 3 && py === 12) ||
            (fx === 4 && (py === 11 || py === 12)) ||
            (fx === 5 && (py === 10 || py === 9)) ||
            (fx === 6 && (py === 8 || py === 7)) ||
            (fx === 7 && py === 6) ||
            (fx === 8 && py === 5) ||
            (fx === 9 && (py === 5 || py === 4)) ||
            (fx === 10 && (py === 4 || py === 3)) ||
            (fx === 11 && py === 3) ||
            (fx === 12 && py === 3)
        );

        if (isArcBody) {
            if (fx === 7 || fx === 8) return woodDark;
            if (py <= 4 || fx >= 10) return woodLight;
            return woodMid;
        }

        if (Math.abs(fx + py - 15) <= 0.8 && fx >= 4 && fx <= 11) {
            return stringColor;
        }

        if (fx === py) {
            if (fx === 13 && py === 13) return arrowFeather;
            if (fx === 14 && py === 14) return arrowFeather;
            if (fx >= 5 && fx <= 12) return arrowShaft;
            if (fx === 3 || fx === 4) return arrowTip;
        }

        return transparent;
    });
}

function generatePlayerBowSprite(scale, isGolden) {
    const frameW = 32 * scale;
    const frameH = 32 * scale;
    const totalW = frameW * 5;
    const totalH = frameH * 9;

    const woodMid = isGolden ? [235, 180, 20, 255] : [150, 80, 25, 255];
    const woodLight = isGolden ? [255, 240, 100, 255] : [200, 130, 45, 255];
    const stringColor = isGolden ? [255, 255, 220, 255] : [235, 235, 235, 255];
    const arrowTip = isGolden ? [255, 255, 255, 255] : [190, 210, 230, 255];
    const transparent = [0, 0, 0, 0];

    return createPng(totalW, totalH, (x, y) => {
        const frameCol = Math.floor(x / frameW);
        const row = Math.floor(y / frameH);
        const fx = Math.floor((x % frameW) / scale);
        const fy = Math.floor((y % frameH) / scale);

        let isBow = false;
        let isString = false;
        let isArrow = false;

        const isAtk = (row === 0 || row === 3 || row === 6);
        const drawBack = (isAtk && (frameCol === 1 || frameCol === 2 || frameCol === 3)) ? 2 : 0;

        if (row === 0 || row === 1 || row === 2) {
            const bx = 18;
            if (fx === bx && fy >= 10 && fy <= 22) isBow = true;
            if (fx === bx - 1 && (fy === 10 || fy === 22)) isBow = true;
            if (fx === bx - 2 && (fy === 9 || fy === 23)) isBow = true;

            const stringX = bx - 1 - drawBack;
            if (fx === stringX && fy >= 11 && fy <= 21) isString = true;

            if (isAtk && frameCol <= 3) {
                if (fy === 16 && fx >= (stringX - 1) && fx <= (bx + 6)) {
                    isArrow = true;
                }
            }
        }
        else if (row === 3 || row === 4 || row === 5) {
            const by = 8;
            if (fy === by && fx >= 10 && fx <= 22) isBow = true;
            if (fy === by + 1 && (fx === 10 || fx === 22)) isBow = true;
            if (fy === by + 2 && (fx === 9 || fx === 23)) isBow = true;

            const stringY = by + 1 + drawBack;
            if (fy === stringY && fx >= 11 && fx <= 21) isString = true;

            if (isAtk && frameCol <= 3) {
                if (fx === 16 && fy >= (by - 6) && fy <= (stringY + 1)) {
                    isArrow = true;
                }
            }
        }
        else {
            const by = 22;
            if (fy === by && fx >= 10 && fx <= 22) isBow = true;
            if (fy === by - 1 && (fx === 10 || fx === 22)) isBow = true;
            if (fy === by - 2 && (fx === 9 || fx === 23)) isBow = true;

            const stringY = by - 1 - drawBack;
            if (fy === stringY && fx >= 11 && fx <= 21) isString = true;

            if (isAtk && frameCol <= 3) {
                if (fx === 16 && fy >= (stringY - 1) && fy <= (by + 6)) {
                    isArrow = true;
                }
            }
        }

        if (isArrow) return arrowTip;
        if (isBow) return (fx + fy) % 2 === 0 ? woodLight : woodMid;
        if (isString) return stringColor;

        return transparent;
    });
}

const baseDir = __dirname;
const scales = [1, 2, 3];

scales.forEach(s => {
    const dir = path.join(baseDir, 'client', 'img', String(s));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(path.join(dir, 'item-bow.png'), generateItemBow(s, false));
    fs.writeFileSync(path.join(dir, 'item-goldenbow.png'), generateItemBow(s, true));
    console.log(`Generated item-bow & item-goldenbow for scale ${s}`);

    fs.writeFileSync(path.join(dir, 'bow.png'), generatePlayerBowSprite(s, false));
    fs.writeFileSync(path.join(dir, 'goldenbow.png'), generatePlayerBowSprite(s, true));
    console.log(`Generated bow & goldenbow spritesheet for scale ${s}`);
});

console.log('All bow assets generated successfully!');
