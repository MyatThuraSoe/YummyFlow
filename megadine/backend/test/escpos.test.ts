import "../scripts/_hermetic-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { EscPosBuilder, escPosRaster, escPosText, CODEPAGES } from "../src/lib/escpos.js";
import { decodePngDataUrl, pngToRaster } from "../src/lib/bitmap.js";

test("escPosText wraps the body in init, feed and cut", () => {
  const bytes = escPosText("hello", { codepage: CODEPAGES.cp437, beep: true });
  assert.deepEqual([...bytes.subarray(0, 2)], [0x1b, 0x40], "job must start with ESC @");
  assert.ok(bytes.includes(Buffer.from([0x1b, 0x74, 0x00])), "codepage command must follow init");
  assert.ok(bytes.includes(Buffer.from("hello")), "body must be present");
  assert.deepEqual([...bytes.subarray(-4)], [0x1d, 0x56, 66, 3], "job must end with a partial cut");
});

test("raster command packs width in bytes and keeps row data", () => {
  const width = 16;
  const height = 2;
  const data = Buffer.from([0xaa, 0x55, 0x80, 0x01]);
  const bytes = new EscPosBuilder().raster({ data, width, height }).build();
  assert.deepEqual([...bytes.subarray(0, 8)], [0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0]);
  assert.deepEqual([...bytes.subarray(8)], [...data]);
});

test("pngToRaster turns dark pixels black and leaves transparent pixels white", () => {
  const png = new PNG({ width: 10, height: 1 });
  // First pixel black, second transparent, rest white.
  png.data.set([0, 0, 0, 255], 0);
  png.data.set([0, 0, 0, 0], 4);
  for (let i = 2; i < 10; i += 1) png.data.set([255, 255, 255, 255], i * 4);
  const raster = pngToRaster(PNG.sync.write(png));
  assert.equal(raster.width, 10);
  assert.equal(raster.height, 1);
  assert.equal(raster.data[0], 0x80, "only the black pixel must be set");
});

test("decodePngDataUrl accepts PNG data URLs and rejects other payloads", () => {
  const png = PNG.sync.write(new PNG({ width: 1, height: 1 }));
  const url = `data:image/png;base64,${png.toString("base64")}`;
  assert.ok(decodePngDataUrl(url)?.length);
  assert.equal(decodePngDataUrl("https://example.com/logo.png"), null);
  assert.equal(decodePngDataUrl("data:image/jpeg;base64,AAAA"), null);
});

test("a raster job is a complete ES/POS job", () => {
  const png = new PNG({ width: 8, height: 1 });
  png.data.set([0, 0, 0, 255], 0);
  const bytes = escPosRaster(pngToRaster(PNG.sync.write(png)), { beep: true });
  assert.deepEqual([...bytes.subarray(0, 2)], [0x1b, 0x40]);
  assert.ok(bytes.includes(Buffer.from([0x1d, 0x76, 0x30, 0x00])));
  assert.deepEqual([...bytes.subarray(-4)], [0x1d, 0x56, 66, 3]);
});
