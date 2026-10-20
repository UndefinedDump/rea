import { createHash } from "node:crypto";
import { createInflate } from "node:zlib";
import { addAbortListener } from "node:events";
import { setImmediate } from "node:timers/promises";
import { getHeapStatistics } from "node:v8";
import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import { ArtifactOperationError } from "../domain/artifactOperationError.js";
import type { FlashArtifactInput } from "../domain/flash/flashArtifact.js";

export const FLASH_OPERATION = "analyze_flash_artifact";
/** Hash large overlapping sprite payloads without monopolizing cancellation. */
export const hashFlashBytes = async (
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<string> => {
  checkFlashCancellation(signal);
  const hash = createHash("sha256");
  const chunk = 4 * 1024 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    checkFlashCancellation(signal);
    hash.update(bytes.subarray(offset, offset + chunk));
    if (offset + chunk < bytes.length) await yieldFlashScan(signal);
  }
  return hash.digest("hex");
};
export const malformedSwf = (reason: string): never => {
  throw new ArtifactOperationError(
    FLASH_OPERATION,
    "format",
    undefined,
    reason,
  );
};
export const swfCapacity = (
  reason: string,
  limits: Record<string, number>,
  resource: "memory" | "capacity" | "file-size" = "capacity",
): never => {
  throw new AnalysisResourceConstraintError(
    FLASH_OPERATION,
    resource,
    reason,
    limits,
    { retryable: false },
  );
};
export const checkFlashCancellation = (signal?: AbortSignal): void => {
  if (signal?.aborted)
    throw new AnalysisCancelledError(FLASH_OPERATION, { cause: signal.reason });
};
export const yieldFlashScan = async (signal?: AbortSignal): Promise<void> => {
  checkFlashCancellation(signal);
  await setImmediate();
  checkFlashCancellation(signal);
};

/** A bounded immutable snapshot, with strict compressed EOF and source extent. */
export const normalizeSwf = async (
  source: Buffer,
  input: FlashArtifactInput,
  signal?: AbortSignal,
): Promise<Buffer> => {
  checkFlashCancellation(signal);
  if (source.length < 8)
    return malformedSwf("Truncated SWF signature/version/length header");
  const signature = source.toString("latin1", 0, 3);
  if (!["FWS", "CWS", "ZWS"].includes(signature))
    throw new AnalysisUnsupportedTargetError(
      FLASH_OPERATION,
      input.path,
      "Expected an FWS, CWS or ZWS signature",
    );
  const version = source[3]!;
  if (version === 0) return malformedSwf("SWF version zero is invalid");
  if (version > 19)
    throw new AnalysisUnsupportedTargetError(
      FLASH_OPERATION,
      input.path,
      "This reader implements SWF 1–19 framing only",
    );
  if (signature === "ZWS")
    throw new AnalysisUnsupportedTargetError(
      FLASH_OPERATION,
      input.path,
      "ZWS/LZMA decoding is not implemented; no tag inventory was produced",
    );
  if (signature === "CWS" && version < 6)
    return malformedSwf("CWS requires SWF version 6 or later");
  const declared = source.readUInt32LE(4);
  if (declared < 13)
    return malformedSwf("Declared SWF extent cannot contain the frame header");
  if (declared > input.max_decoded_bytes)
    return swfCapacity(
      "Declared normalized SWF exceeds the decoded-byte budget",
      { declared_bytes: declared, max_decoded_bytes: input.max_decoded_bytes },
      "file-size",
    );
  const available = getHeapStatistics().total_available_size;
  if (declared * 12 > available)
    return swfCapacity(
      "Normalized SWF and optional byte capture exceed available heap admission",
      {
        declared_bytes: declared,
        required_heap_bytes: declared * 12,
        available_heap_bytes: available,
      },
      "memory",
    );
  if (signature === "FWS") {
    if (source.length !== declared)
      return malformedSwf(
        "FWS physical extent differs from its declared FileLength",
      );
    return source;
  }
  const inflater = createInflate();
  const cancellation =
    signal === undefined
      ? undefined
      : addAbortListener(signal, () =>
          inflater.destroy(
            new AnalysisCancelledError(FLASH_OPERATION, {
              cause: signal.reason,
            }),
          ),
        );
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    inflater.end(source.subarray(8));
    for await (const value of inflater) {
      checkFlashCancellation(signal);
      const chunk: Buffer = value;
      length += chunk.length;
      if (length > declared - 8)
        return malformedSwf("CWS output exceeds its declared FileLength");
      chunks.push(chunk);
    }
    if (length !== declared - 8)
      return malformedSwf("CWS output does not fill its declared FileLength");
    if (inflater.bytesWritten !== source.length - 8)
      return malformedSwf("Trailing input follows the CWS zlib stream");
  } catch (cause: unknown) {
    checkFlashCancellation(signal);
    if (cause instanceof ArtifactOperationError) throw cause;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? cause.code
        : undefined;
    if (code === "Z_MEM_ERROR")
      return swfCapacity(
        "zlib exhausted memory while decoding CWS",
        {},
        "memory",
      );
    if (code === "Z_DATA_ERROR" || code === "Z_BUF_ERROR")
      return malformedSwf(
        "CWS stream is truncated or failed zlib integrity validation",
      );
    throw cause;
  } finally {
    cancellation?.[Symbol.dispose]();
    inflater.destroy();
  }
  const normalized = Buffer.concat(
    [source.subarray(0, 8), ...chunks],
    declared,
  );
  normalized[0] = 0x46;
  return normalized;
};

/** SWF bit fields are MSB-first; rectangle values are signed twips. */
export const readSwfFrameHeader = (bytes: Buffer) => {
  let bit = 64;
  const unsigned = (width: number): number => {
    if (bit + width > bytes.length * 8)
      return malformedSwf("Truncated RECT field");
    let value = 0;
    for (let index = 0; index < width; index++, bit++)
      value = value * 2 + ((bytes[bit >> 3]! >> (7 - (bit & 7))) & 1);
    return value;
  };
  const width = unsigned(5);
  const signed = (): number => {
    const value = unsigned(width);
    return width > 0 && value >= 2 ** (width - 1) ? value - 2 ** width : value;
  };
  const rect = {
    x_min: signed(),
    x_max: signed(),
    y_min: signed(),
    y_max: signed(),
  };
  if (rect.x_min > rect.x_max || rect.y_min > rect.y_max)
    return malformedSwf("RECT minimum exceeds maximum");
  const offset = Math.ceil(bit / 8);
  if (offset + 4 > bytes.length)
    return malformedSwf("Truncated frame rate/count");
  const raw = bytes.readUInt16LE(offset);
  return {
    version: bytes[3]!,
    declared_length: bytes.readUInt32LE(4),
    rect_twips: rect,
    rect_logical_pixels: {
      x_min: rect.x_min / 20,
      x_max: rect.x_max / 20,
      y_min: rect.y_min / 20,
      y_max: rect.y_max / 20,
    },
    frame_rate_raw: raw,
    frame_rate: raw / 256,
    declared_frames: bytes.readUInt16LE(offset + 2),
    tags_start: offset + 4,
  };
};
