import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BYTES, checkDimensions, checkFile, safeHex, validateBrief } from "../js/validation.js";
import { normalizeError } from "../js/api.js";

const file = (name, type, size = 1000) => ({ name, type, size });

test("accepts jpeg/png/webp within size", () => {
  for (const [n, t] of [["a.jpg", "image/jpeg"], ["b.JPEG", "image/jpeg"], ["c.png", "image/png"], ["d.webp", "image/webp"]]) {
    assert.equal(checkFile(file(n, t)), null, n);
  }
});

test("rejects missing, wrong type, HEIC, empty and oversize files", () => {
  assert.match(checkFile(null), /Choose a photo/);
  assert.match(checkFile(file("a.gif", "image/gif")), /JPEG, PNG or WebP/);
  assert.match(checkFile(file("a.jpg", "text/plain")), /JPEG, PNG or WebP/);
  assert.match(checkFile(file("IMG_1.HEIC", "image/heic")), /HEIC/);
  assert.match(checkFile(file("a.jpg", "image/jpeg", 0)), /empty/);
  assert.match(checkFile(file("a.jpg", "image/jpeg", MAX_BYTES + 1)), /limit is 8\.0 MB/);
});

test("dimension rules", () => {
  assert.equal(checkDimensions(640, 800), null);
  assert.match(checkDimensions(150, 800), /too small/);
  assert.match(checkDimensions(9000, 800), /too large/);
  assert.match(checkDimensions(0, 0), /couldn't be read/);
});

test("brief validation requires photo and occasion and caps text", () => {
  const ok = validateBrief({ file: file("a.jpg", "image/jpeg"), occasion: "work", fields: {} });
  assert.deepEqual(ok, { valid: true, errors: {} });
  const bad = validateBrief({ file: null, occasion: "", fields: { additional_context: "x".repeat(301) } });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.image && bad.errors.occasion && bad.errors.additional_context);
  const prior = validateBrief({ file: file("a.jpg", "image/jpeg"), fileError: "too small", occasion: "party", fields: {} });
  assert.equal(prior.errors.image, "too small");
  assert.ok(validateBrief({ file: file("a.jpg", "image/jpeg"), occasion: "funeral", fields: {} }).errors.occasion);
});

test("safeHex only allows #rrggbb", () => {
  assert.equal(safeHex("#a1b2c3"), "#a1b2c3");
  for (const v of ["red", "#abc", "url(x)", "#a1b2c3;background:url(x)", null, 5]) assert.equal(safeHex(v), null);
});

test("normalizeError uses server envelope or a status fallback", () => {
  const e = normalizeError(400, { error: { code: "validation_error", message: "Bad image", fields: { image: ["Bad image"] } } });
  assert.equal(e.code, "validation_error");
  assert.equal(e.message, "Bad image");
  assert.deepEqual(e.fields, { image: ["Bad image"] });
  assert.match(normalizeError(0, null).message, /Can't reach/);
  assert.equal(normalizeError(0, null).code, "network_error");
  assert.match(normalizeError(504, "<html>").message, /too long/);
  assert.match(normalizeError(418, null).message, /Something went wrong/);
});
