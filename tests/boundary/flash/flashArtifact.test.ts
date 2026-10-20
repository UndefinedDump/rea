import { createHash } from "node:crypto";
import { lstat, open, readFile, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FlashArtifactProvider } from "../../../src/flash/FlashArtifactProvider.js";
import { FlashArtifactService } from "../../../src/application/flash/FlashArtifactService.js";
import { analyzeFlashArtifactInputSchema } from "../../../src/domain/flash/flashArtifact.js";
import { hashFlashBytes } from "../../../src/flash/SwfFraming.js";
import { inspectSwfBytes } from "../../../src/flash/SwfTagInventory.js";
import {
  flashMovie,
  flashTag,
  flashSprite,
  FLASH_ABC_BYTES,
} from "../../fixtures/flash.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

afterEach(() => vi.restoreAllMocks());
const digest = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
const inspect = (bytes: Buffer, options: Record<string, unknown> = {}) =>
  inspectSwfBytes(
    bytes,
    digest(bytes),
    analyzeFlashArtifactInputSchema.parse({
      path: "/owned/movie.swf",
      ...options,
    }),
  );

it("keeps equivalent FWS/CWS coordinates separate from acquired identities", async () => {
  const plain = await inspect(flashMovie(), { capture_raw: true });
  const compressed = await inspect(flashMovie(undefined, true), {
    capture_raw: true,
  });
  expect(plain.report.artifact.sha256).not.toBe(
    compressed.report.artifact.sha256,
  );
  expect(plain.report.normalized_stream).toEqual(
    compressed.report.normalized_stream,
  );
  expect(plain.report.tags).toEqual(compressed.report.tags);
  expect(plain.report.header.rect_logical_pixels).toEqual({
    x_min: 0,
    x_max: 100,
    y_min: 0,
    y_max: 50,
  });
  expect(plain.report.header.frame_rate).toBe(24);
  expect(plain.report.inventory).toMatchObject({
    sprite_streams: 1,
    abc_occurrences: 2,
    unique_abc_blobs: 1,
    opaque_binary_data: 1,
  });
  const occurrences = plain.report.tags.items.filter(({ abc }) => abc !== null);
  expect(occurrences).toHaveLength(2);
  expect(occurrences[0]!.abc!.start).not.toBe(occurrences[1]!.abc!.start);
  expect(occurrences[0]!.abc!.sha256).toBe(occurrences[1]!.abc!.sha256);
  expect(
    plain.rawResult!.blobs.filter(
      ({ sha256 }) => sha256 === digest(FLASH_ABC_BYTES),
    ),
  ).toHaveLength(1);
  for (const blob of plain.rawResult!.blobs)
    expect(digest(Buffer.from(blob.base64, "base64"))).toBe(blob.sha256);
  expect(plain.report.coverage).toMatchObject({
    abc_classes_traits_methods: "uninterpreted",
    binary_data_contents: "uninterpreted",
    runtime: "not-executed",
  });
});

it("pages delivery without changing the inspected denominator or inventing ABC semantics", async () => {
  const report = (await inspect(flashMovie(), { offset: 1, limit: 1 })).report;
  expect(report.tags.items).toHaveLength(1);
  expect(report.tags.items[0]!.index).toBe(1);
  expect(report.tags.has_more).toBe(true);
  expect(report.inventory.abc_occurrences).toBe(2);
  expect(report.raw_capture.status).toBe("not-requested");
  expect(report.coverage.payload_semantics).toBe("partial");
  const emptyPage = (await inspect(flashMovie(), { offset: 100 })).report;
  expect(emptyPage.tags.returned).toBe(0);
  expect(emptyPage.tags.total).toBe(report.tags.total);
  expect(emptyPage.coverage.abc_classes_traits_methods).toBe("uninterpreted");
});

it.each([
  ["truncated header", () => Buffer.from("FWS")],
  [
    "declared extent",
    () => {
      const bytes = flashMovie();
      bytes.writeUInt32LE(bytes.length + 1, 4);
      return bytes;
    },
  ],
  [
    "truncated RECT",
    () => {
      const bytes = Buffer.alloc(13);
      bytes.write("FWS");
      bytes[3] = 19;
      bytes.writeUInt32LE(13, 4);
      bytes[8] = 0xf8;
      return bytes;
    },
  ],
  [
    "long tag overrun",
    () => {
      const bytes = flashTag(2, Buffer.alloc(1), true);
      bytes.writeUInt32LE(0xffffffff, 2);
      return flashMovie([bytes]);
    },
  ],
  ["truncated long tag header", () => flashMovie([Buffer.from([0xbf, 0])])],
  [
    "unterminated DoABC name",
    () => flashMovie([flashTag(82, Buffer.from([0, 0, 0, 0, 65]))]),
  ],
  [
    "reserved DoABC flags",
    () => flashMovie([flashTag(82, Buffer.from([2, 0, 0, 0, 0]))]),
  ],
  ["trailing End bytes", () => flashMovie([flashTag(0), flashTag(1)])],
  [
    "trailing zlib input",
    () => Buffer.concat([flashMovie(undefined, true), Buffer.from([1, 2])]),
  ],
  ["truncated zlib stream", () => flashMovie(undefined, true).subarray(0, -2)],
] as const)("rejects malformed framing: %s", async (_name, create) => {
  await expect(inspect(create())).rejects.toMatchObject({
    _tag: "ArtifactOperationError",
    reason: "format",
  });
});

it.each([
  ["tags", { max_tags: 1 }],
  ["decoded bytes", { max_decoded_bytes: 16 }],
  ["raw retention", { capture_raw: true, max_raw_bytes: 1 }],
  ["sprite depth", { max_nesting: 1 }],
] as const)(
  "reports the caller's exhausted %s budget",
  async (name, options) => {
    const movie =
      name === "sprite depth"
        ? flashMovie([flashSprite([flashSprite([])])])
        : flashMovie();
    await expect(inspect(movie, options)).rejects.toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      retryable: false,
    });
  },
);

it.each(["ZWS", "unknown version"])(
  "returns unsupported rather than empty inventory for %s",
  async (kind) => {
    const bytes = flashMovie();
    if (kind === "ZWS") bytes.write("ZWS");
    else bytes[3] = 255;
    await expect(inspect(bytes)).rejects.toMatchObject({
      _tag: "AnalysisUnsupportedTargetError",
    });
  },
);

it("keeps failed descriptor cleanup owned and preserves completed source facts until retry", async () => {
  const root = await createTestTempDirectory("rea-flash-cleanup-");
  const path = join(root, "owned.swf");
  const bytes = flashMovie();
  await writeFile(path, bytes);
  let denyClose = true;
  let retained: FileHandle | undefined;
  const provider = new FlashArtifactProvider({
    lstat: (path) => lstat(path, { bigint: true }),
    open: async (path, flags) => {
      const file = await open(path, flags);
      retained = file;
      const close = file.close.bind(file);
      file.close = async () => {
        if (denyClose) throw new Error("controlled close denial");
        await close();
      };
      return file;
    },
  });
  const service = new FlashArtifactService(provider);
  try {
    const result = await service.inspect({ path });
    expect(result).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: true,
        partialObservation: {
          kind: "file-snapshot-hash",
          path,
          sha256: digest(bytes),
          bytes: bytes.length,
        },
      },
    });
    expect(retained?.fd).toBeGreaterThanOrEqual(0);
    await expect(service.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    denyClose = false;
    await service.close();
    expect(retained?.fd).toBe(-1);
    expect(result.ok ? undefined : result.error.cleanupIncomplete).toBe(false);
    expect(await readFile(path)).toEqual(bytes);
  } finally {
    denyClose = false;
    await service.close();
  }
});

it.each([false, true])(
  "retains cancellation during file finalization, with failed close=%s",
  async (fails) => {
    const root = await createTestTempDirectory("rea-flash-finalization-");
    const path = join(root, "owned.swf");
    const bytes = flashMovie();
    await writeFile(path, bytes);
    const controller = new AbortController();
    const reason = { phase: "descriptor-finalization" };
    let deny = fails;
    const provider = new FlashArtifactProvider({
      lstat: (path) => lstat(path, { bigint: true }),
      open: async (path, flags) => {
        const file = await open(path, flags);
        const close = file.close.bind(file);
        file.close = async () => {
          controller.abort(reason);
          if (deny)
            throw new Error("controlled close denial during cancellation");
          await close();
        };
        return file;
      },
    });
    try {
      const result = await new FlashArtifactService(provider).inspect(
        { path },
        { signal: controller.signal },
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          cleanupIncomplete: fails,
          partialObservation: {
            kind: "file-snapshot-hash",
            path,
            sha256: digest(bytes),
            bytes: bytes.length,
          },
        },
      });
      if (result.ok) throw new Error("Expected cancellation");
      if (fails) {
        expect(result.error._tag).toBe("ProviderAdapterError");
        expect(result.error.cause).toBeInstanceOf(AggregateError);
        const primary = (result.error.cause as AggregateError).cause;
        expect(primary).toMatchObject({ _tag: "AnalysisCancelledError" });
        expect((primary as Error).cause).toBe(reason);
      } else {
        expect(result.error._tag).toBe("AnalysisCancelledError");
        expect(result.error.cause).toBe(reason);
      }
      deny = false;
      await provider.close();
      expect(result.ok ? undefined : result.error.cleanupIncomplete).toBe(
        false,
      );
    } finally {
      deny = false;
      await provider.close();
    }
  },
);

it("rejects source mutation observed at the final pathname identity check", async () => {
  const root = await createTestTempDirectory("rea-flash-mutation-");
  const path = join(root, "owned.swf");
  const bytes = flashMovie();
  await writeFile(path, bytes);
  let observed = 0;
  const provider = new FlashArtifactProvider({
    lstat: async (selected) => {
      if (++observed === 2)
        await writeFile(path, Buffer.concat([bytes, Buffer.from([1])]));
      return lstat(selected, { bigint: true });
    },
    open,
  });
  try {
    expect(
      await new FlashArtifactService(provider).inspect({ path }),
    ).toMatchObject({ ok: false, error: { reason: "integrity" } });
  } finally {
    await provider.close();
  }
});

it("preserves unknown long-tag payload commitments without claiming interpretation", async () => {
  const payload = Buffer.alloc(70, 0x5a);
  const result = await inspect(flashMovie([flashTag(1023, payload, true)]));
  expect(result.report.tags.items[0]).toMatchObject({
    code: 1023,
    name: "Tag1023",
    payload_sha256: digest(payload),
  });
  expect(result.report.coverage.payload_semantics).toBe("partial");
});

it("yields cancellation while hashing a large overlapping sprite payload", async () => {
  const controller = new AbortController();
  const reason = { phase: "payload-hash" };
  const pending = hashFlashBytes(
    Buffer.alloc(12 * 1024 * 1024),
    controller.signal,
  );
  controller.abort(reason);
  await expect(pending).rejects.toMatchObject({
    _tag: "AnalysisCancelledError",
    cause: reason,
  });
});

it("rejects a high-bit signature instead of ASCII-folding it into FWS", async () => {
  const bytes = flashMovie();
  bytes[0] = 0xc6;
  await expect(inspect(bytes)).rejects.toMatchObject({
    _tag: "AnalysisUnsupportedTargetError",
  });
});
