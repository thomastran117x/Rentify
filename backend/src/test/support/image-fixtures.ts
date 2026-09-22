import sharp from "sharp";
import { crc32 } from "node:zlib";

// Real encoded image bytes, generated at test time rather than committed as
// binary fixtures. The upload path sniffs content with sharp, so tests can no
// longer stand in a Buffer of arbitrary text and call it a PNG.

function createCanvas(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: {
        r: 255,
        g: 255,
        b: 255,
      },
    },
  });
}

export function createPngFixture(width = 4, height = 4): Promise<Buffer> {
  return createCanvas(width, height).png().toBuffer();
}

export function createJpegFixture(width = 4, height = 4): Promise<Buffer> {
  return createCanvas(width, height).jpeg().toBuffer();
}

export function createWebpFixture(width = 4, height = 4): Promise<Buffer> {
  return createCanvas(width, height).webp().toBuffer();
}

// A valid header over damaged pixel data. metadata() accepts both of these -
// they still report their full dimensions - so they prove that validation
// decodes the image rather than trusting the header.
export function truncateImage(image: Buffer, keepRatio = 0.6): Buffer {
  return image.subarray(0, Math.floor(image.length * keepRatio));
}

export function corruptImageTail(image: Buffer): Buffer {
  const damaged = Buffer.from(image);

  for (
    let index = Math.floor(damaged.length * 0.5);
    index < damaged.length - 16;
    index++
  ) {
    damaged[index] ^= 0x5a;
  }

  return damaged;
}

// A format sharp can decode but the policy deliberately excludes, used to prove
// the allow-list is narrower than "whatever sharp accepts".
export function createGifFixture(width = 4, height = 4): Promise<Buffer> {
  return createCanvas(width, height).gif().toBuffer();
}

const FRAME_COLOURS = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 0, g: 255, b: 0 },
];

function createFrames(count: number, size: number): Promise<Buffer[]> {
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      sharp({
        create: {
          width: size,
          height: size,
          channels: 3,
          background: FRAME_COLOURS[index % FRAME_COLOURS.length],
        },
      })
        .png()
        .toBuffer(),
    ),
  );
}

// An animated WebP whose frames are red, blue, green, ... in that order.
export async function createAnimatedWebpFixture(
  frames = 2,
  size = 8,
): Promise<Buffer> {
  return sharp(await createFrames(frames, size), { join: { animated: true } })
    .webp({ loop: 0, delay: Array(frames).fill(100) })
    .toBuffer();
}

function riffChunk(fourcc: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(fourcc, 0, "ascii");
  header.writeUInt32LE(data.length, 4);

  return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
}

function uint24(value: number): Buffer {
  const bytes = Buffer.alloc(3);
  bytes.writeUIntLE(value, 0, 3);
  return bytes;
}

// A WebP in the animated container holding exactly one frame. libvips never
// writes one, so it is assembled by hand around a static lossless bitstream.
export async function createSingleFrameAnimatedWebpFixture(
  size = 8,
): Promise<Buffer> {
  const [frame] = await createFrames(1, size);
  // A simple-format WebP is RIFF, size, "WEBP", then a single VP8L chunk.
  const bitstream = (
    await sharp(frame).webp({ lossless: true }).toBuffer()
  ).subarray(12);
  const edge = uint24(size - 1);
  const body = Buffer.concat([
    Buffer.from("WEBP"),
    // Flags byte 0x02 marks the file as animated.
    riffChunk(
      "VP8X",
      Buffer.concat([Buffer.from([0x02, 0, 0, 0]), edge, edge]),
    ),
    riffChunk("ANIM", Buffer.alloc(6)),
    riffChunk(
      "ANMF",
      Buffer.concat([
        uint24(0),
        uint24(0),
        edge,
        edge,
        uint24(100),
        Buffer.alloc(1),
        bitstream,
      ]),
    ),
  ]);

  return riffChunk("RIFF", body);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0);

  return Buffer.concat([length, typeAndData, crc]);
}

function pngChunks(png: Buffer): { type: string; data: Buffer }[] {
  const chunks: { type: string; data: Buffer }[] = [];

  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    chunks.push({
      type: png.toString("ascii", offset + 4, offset + 8),
      data: png.subarray(offset + 8, offset + 8 + length),
    });
    offset += 12 + length;
  }

  return chunks;
}

// A two-frame APNG, red then blue. sharp cannot write APNG, so the second
// frame's image data is spliced in as fdAT chunks behind acTL and fcTL.
export async function createApngFixture(size = 8): Promise<Buffer> {
  const [first, second] = (await createFrames(2, size)).map(pngChunks);
  const frameControl = (sequence: number) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(size, 4);
    data.writeUInt32BE(size, 8);
    data.writeUInt16BE(1, 20);
    data.writeUInt16BE(10, 22);
    return pngChunk("fcTL", data);
  };
  const animationControl = Buffer.alloc(8);
  animationControl.writeUInt32BE(2, 0);
  let sequence = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...first
      .filter((chunk) => chunk.type === "IHDR")
      .map((chunk) => pngChunk(chunk.type, chunk.data)),
    pngChunk("acTL", animationControl),
    frameControl(0),
    ...first
      .filter((chunk) => chunk.type === "IDAT")
      .map((chunk) => pngChunk("IDAT", chunk.data)),
    frameControl(1),
    ...second
      .filter((chunk) => chunk.type === "IDAT")
      .map((chunk) => {
        const sequenceNumber = Buffer.alloc(4);
        sequenceNumber.writeUInt32BE(sequence++);
        return pngChunk("fdAT", Buffer.concat([sequenceNumber, chunk.data]));
      }),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
