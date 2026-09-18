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

// A format sharp can decode but the policy deliberately excludes, used to prove
// the allow-list is narrower than "whatever sharp accepts".
export function createGifFixture(width = 4, height = 4): Promise<Buffer> {
  return createCanvas(width, height).gif().toBuffer();
}
