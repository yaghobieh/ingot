/** IDEA-144: minimal ZIP reader for .vsix packages (stored + deflate), using the platform DecompressionStream. */

export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_SEARCH = 0xffff + EOCD_MIN;
const STORED = 0;
const DEFLATE = 8;
/** Per-entry cap; theme files and manifests are small. */
export const MAX_ZIP_ENTRY_BYTES = 5_000_000;

export const inflateRaw: Inflate = async data => {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
};

const findEndOfCentralDirectory = (view: DataView): number => {
    const stop = Math.max(0, view.byteLength - EOCD_SEARCH);
    for (let i = view.byteLength - EOCD_MIN; i >= stop; i--) {
        if (view.getUint32(i, true) === EOCD_SIGNATURE) {
            return i;
        }
    }
    throw new Error('Not a zip archive.');
};

/** Reads the entries whose names pass `wanted` (text decoding is left to the caller). */
export async function readZipEntries(buffer: ArrayBuffer, wanted: (name: string) => boolean, inflate: Inflate = inflateRaw): Promise<Map<string, Uint8Array>> {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const decoder = new TextDecoder();
    const eocd = findEndOfCentralDirectory(view);
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const result = new Map<string, Uint8Array>();
    for (let i = 0; i < count; i++) {
        if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
            throw new Error('Corrupt zip central directory.');
        }
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const size = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
        offset += 46 + nameLength + extraLength + commentLength;
        if (name.endsWith('/') || !wanted(name)) {
            continue;
        }
        if (size > MAX_ZIP_ENTRY_BYTES || compressedSize > MAX_ZIP_ENTRY_BYTES) {
            throw new Error(`${name} is too large.`);
        }
        if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
            throw new Error('Corrupt zip entry.');
        }
        const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const data = bytes.subarray(start, start + compressedSize);
        if (method === STORED) {
            result.set(name, data.slice());
        } else if (method === DEFLATE) {
            result.set(name, await inflate(data));
        } else {
            throw new Error(`Unsupported zip compression (${method}).`);
        }
    }
    return result;
}
