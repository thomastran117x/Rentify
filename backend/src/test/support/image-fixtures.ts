import sharp from "sharp";

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
