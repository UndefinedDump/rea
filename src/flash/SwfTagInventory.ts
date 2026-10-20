import { getHeapStatistics } from "node:v8";
import type {
  FlashArtifact,
  FlashArtifactInput,
  FlashArtifactObservation,
  FlashTag,
} from "../domain/flash/flashArtifact.js";
import {
  checkFlashCancellation,
  malformedSwf,
  normalizeSwf,
  readSwfFrameHeader,
  hashFlashBytes,
  swfCapacity,
  yieldFlashScan,
} from "./SwfFraming.js";

const NAMES: Readonly<Record<number, string>> = {
  0: "End",
  1: "ShowFrame",
  12: "DoAction",
  39: "DefineSprite",
  59: "DoInitAction",
  69: "FileAttributes",
  72: "DoABCDefine",
  82: "DoABC",
  87: "DefineBinaryData",
};
const LIMITATIONS = [
  "Coordinates name the normalized FWS stream and are end-exclusive. CWS ranges are not physical compressed-file offsets.",
  "Complete framing covers only the root and nested DefineSprite tag streams. Other tag payload semantics, DefineBinaryData contents, AVM1 instructions and ABC constant pools/classes/traits/method bodies are uninterpreted.",
  "ABC hashes identify captured bytes, not valid or decompiled ActionScript. No asset conversion, AMF/SOL parsing, URL discovery, network calls or runtime execution was performed.",
];

/** Walk each owned tag stream once; only the selected page retains row objects. */
export const inspectSwfBytes = async (
  source: Buffer,
  sourceSha256: string,
  input: FlashArtifactInput,
  signal?: AbortSignal,
): Promise<FlashArtifactObservation> => {
  const bytes = await normalizeSwf(source, input, signal);
  const header = readSwfFrameHeader(bytes);
  const normalizedSha256 = await hashFlashBytes(bytes, signal);
  const stack = [
    {
      offset: header.tags_start,
      end: bytes.length,
      parent: null as number | null,
      depth: 0,
    },
  ];
  const items: FlashTag[] = [];
  const counts = new Map<number, number>();
  const abcDigests = new Set<string>();
  const captured = new Map<string, Buffer>();
  let capturedBytes = 0;
  const capture = (hash: string, data: Buffer): void => {
    if (!input.capture_raw || captured.has(hash)) return;
    const encodedBytes = 4 * Math.ceil(data.length / 3);
    if (capturedBytes + encodedBytes > input.max_raw_bytes)
      swfCapacity(
        "Content-addressed byte capture exceeds the raw retention budget",
        {
          encoded_bytes_at_least: capturedBytes + encodedBytes,
          max_raw_bytes: input.max_raw_bytes,
        },
      );
    capturedBytes += encodedBytes;
    captured.set(hash, data);
  };
  capture(sourceSha256, source);
  capture(normalizedSha256, bytes);
  let total = 0;
  let roots = 0;
  let sprites = 0;
  let binary = 0;
  let actions = 0;
  let abcCount = 0;
  while (stack.length > 0) {
    const stream = stack.at(-1)!;
    if ((total & 255) === 0) await yieldFlashScan(signal);
    checkFlashCancellation(signal);
    if (total >= input.max_tags)
      swfCapacity("SWF tag scan exceeds the caller's occurrence budget", {
        max_tags: input.max_tags,
        tags_at_least: total + 1,
      });
    const start = stream.offset;
    if (start + 2 > stream.end)
      malformedSwf("Tag stream ended without an End tag");
    const packed = bytes.readUInt16LE(start);
    const code = packed >>> 6;
    let length = packed & 63;
    let payload = start + 2;
    if (length === 63) {
      if (payload + 4 > stream.end) malformedSwf("Truncated long tag header");
      length = bytes.readUInt32LE(payload);
      payload += 4;
    }
    const end = payload + length;
    if (end > stream.end)
      malformedSwf("Tag payload crosses its owning stream extent");
    // Commit to the raw payload before interpreting any known tag framing.
    const payloadSha256 = await hashFlashBytes(
      bytes.subarray(payload, end),
      signal,
    );
    const index = total++;
    if (stream.parent === null) roots++;
    counts.set(code, (counts.get(code) ?? 0) + 1);
    const row: FlashTag = {
      index,
      code,
      name: NAMES[code] ?? `Tag${code}`,
      stream_id: "normalized-fws",
      parent_tag_index: stream.parent,
      depth: stream.depth,
      start,
      payload_start: payload,
      end,
      payload_sha256: payloadSha256,
      sprite: null,
      binary_data: null,
      abc: null,
    };
    stream.offset = end;
    if (code === 0 || code === 1) {
      if (length !== 0)
        malformedSwf("End and ShowFrame tags require empty payloads");
      if (code === 0) {
        if (end !== stream.end)
          malformedSwf("Bytes follow End inside its owning tag stream");
        stack.pop();
      }
    } else if (code === 39) {
      if (length < 6) malformedSwf("Truncated DefineSprite header or End tag");
      if (stream.depth + 1 > input.max_nesting)
        swfCapacity("DefineSprite nesting exceeds its caller-selected budget", {
          max_nesting: input.max_nesting,
          depth_at_least: stream.depth + 1,
        });
      row.sprite = {
        id: bytes.readUInt16LE(payload),
        declared_frames: bytes.readUInt16LE(payload + 2),
      };
      sprites++;
      stack.push({
        offset: payload + 4,
        end,
        parent: index,
        depth: stream.depth + 1,
      });
    } else if (code === 87) {
      if (length < 6) malformedSwf("Truncated DefineBinaryData framing");
      if (bytes.readUInt32LE(payload + 2) !== 0)
        malformedSwf("DefineBinaryData reserved field must be zero");
      row.binary_data = {
        id: bytes.readUInt16LE(payload),
        data_start: payload + 6,
        data_sha256: await hashFlashBytes(
          bytes.subarray(payload + 6, end),
          signal,
        ),
      };
      binary++;
    } else if (code === 12 || code === 59) {
      if (code === 59 && length < 2)
        malformedSwf("DoInitAction is missing its sprite ID");
      actions++;
    } else if (code === 82 || code === 72) {
      let abcStart = payload;
      let name: string | null = null;
      let flags: number | null = null;
      if (code === 82) {
        if (length < 5) malformedSwf("DoABC needs flags and a terminated name");
        flags = bytes.readUInt32LE(payload);
        if ((flags & ~1) !== 0)
          malformedSwf("DoABC contains reserved flag bits");
        const terminator = bytes.indexOf(0, payload + 4);
        if (terminator < 0 || terminator >= end)
          malformedSwf("DoABC name has no terminator within its payload");
        try {
          name = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(bytes.subarray(payload + 4, terminator));
        } catch {
          malformedSwf("DoABC name is not valid UTF-8");
        }
        abcStart = terminator + 1;
      }
      const data = bytes.subarray(abcStart, end);
      const hash = await hashFlashBytes(data, signal);
      row.abc = {
        kind: code === 82 ? "DoABC" : "DoABCDefine",
        flags,
        name,
        start: abcStart,
        bytes: data.length,
        sha256: hash,
      };
      abcCount++;
      if (!abcDigests.has(hash)) {
        // Unique digest retention expands tiny ABC payloads. Reserve a
        // conservative per-entry heap allowance before growing the set.
        if (
          (abcDigests.size + 1) * 256 >
          getHeapStatistics().total_available_size / 2
        )
          swfCapacity(
            "Unique ABC commitments exceed available heap headroom",
            {
              unique_abc_blobs: abcDigests.size,
            },
            "memory",
          );
        abcDigests.add(hash);
      }
      capture(hash, data);
    }
    if (index >= input.offset && index - input.offset < input.limit)
      items.push(row);
  }
  checkFlashCancellation(signal);
  const report: FlashArtifact = {
    artifact: {
      path: input.path,
      sha256: sourceSha256,
      bytes: source.length,
      signature: source.toString("latin1", 0, 3) as "FWS" | "CWS",
    },
    normalized_stream: {
      id: "normalized-fws",
      sha256: normalizedSha256,
      bytes: bytes.length,
      offset_basis: "normalized-stream-end-exclusive",
    },
    header,
    inventory: {
      tags: total,
      top_level_tags: roots,
      sprite_streams: sprites,
      opaque_binary_data: binary,
      avm1_blocks: actions,
      abc_occurrences: abcCount,
      unique_abc_blobs: abcDigests.size,
      by_code: [...counts]
        .sort(([a], [b]) => a - b)
        .map(([code, count]) => ({ code, count })),
    },
    tags: {
      offset: input.offset,
      limit: input.limit,
      total,
      returned: items.length,
      has_more: input.offset + items.length < total,
      items,
    },
    coverage: {
      header: "complete",
      tag_framing: "complete",
      sprite_tag_framing: "complete",
      payload_semantics: "partial",
      binary_data_contents: "uninterpreted",
      abc_framing: "complete",
      abc_classes_traits_methods: "uninterpreted",
      avm1_actions: "uninterpreted",
      decompiled_control_flow: "not-performed",
      asset_conversion: "not-performed",
      amf_and_network_behavior: "not-inspected",
      runtime: "not-executed",
    },
    raw_capture: {
      status: input.capture_raw ? "captured" : "not-requested",
      blobs: captured.size,
      encoded_bytes: capturedBytes,
    },
    limitations: [
      ...LIMITATIONS,
      ...(input.capture_raw
        ? []
        : [
            "Raw stream/blob bytes were not requested; digests and normalized ranges are commitments, not persisted byte captures.",
          ]),
    ],
  };
  if (!input.capture_raw) return { report };
  const blobs = [];
  for (const [hash, data] of captured) {
    await yieldFlashScan(signal);
    blobs.push({
      sha256: hash,
      bytes: data.length,
      base64: data.toString("base64"),
    });
  }
  return {
    report,
    rawResult: {
      source_blob: sourceSha256,
      normalized_blob: normalizedSha256,
      blobs,
    },
  };
};
