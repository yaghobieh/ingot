import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deflateSync } from 'zlib';

/** IDEA-145: tiny RGBA PNG encoder for e2e fixtures (left half opaque gold, right half transparent). */
const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
});
const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) {
        c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
};

export function makePng(width: number, height: number): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const rows: Buffer[] = [];
    for (let y = 0; y < height; y++) {
        const row = Buffer.alloc(1 + width * 4);
        for (let x = 0; x < width; x++) {
            const opaque = x < width / 2;
            row.set(opaque ? [0xd9, 0xa0, 0x4e, 0xff] : [0x3b, 0x6f, 0xd9, 0x00], 1 + x * 4);
        }
        rows.push(row);
    }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

export const SVG_SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" rx="4" fill="#3B6FD9"/></svg>\n';

/** A throwaway project with images, a code file pointing at one, and a package.json. */
export function makeImageProject(): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-images-')));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'assets', 'logo.png'), makePng(64, 32));
    fs.writeFileSync(path.join(dir, 'assets', 'icon.svg'), SVG_SOURCE);
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), "import logo from '../assets/logo.png';\n\nexport const brand = { logo };\n");
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'images-project', private: true }, undefined, 2));
    return dir;
}
