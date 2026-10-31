import { crc32 } from 'zlib';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const ZIP_VERSION = 20;
const STORED = 0;

/** A minimal stored (uncompressed) zip, like `ingot pack` writes: manifest `ingot.json` plus the given files. */
export const buildIngotx = (manifest: object, files: Record<string, string>): Buffer => {
    const entries = Object.entries({ 'ingot.json': JSON.stringify(manifest, undefined, 2), ...files }).map(([name, text]) => ({ name: Buffer.from(name), data: Buffer.from(text) }));
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const { name, data } of entries) {
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(LOCAL_HEADER, 0);
        local.writeUInt16LE(ZIP_VERSION, 4);
        local.writeUInt16LE(STORED, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        locals.push(local, name, data);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(CENTRAL_HEADER, 0);
        central.writeUInt16LE(ZIP_VERSION, 4);
        central.writeUInt16LE(ZIP_VERSION, 6);
        central.writeUInt16LE(STORED, 10);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);
        offset += local.length + name.length + data.length;
    }
    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...centrals, end]);
};
