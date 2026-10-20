import { z } from "zod";
import { absoluteLocalPathStringSchema } from "../localPath.js";

const count = z.number().int().nonnegative().safe();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const bytes = (maximum: number, initial: number) =>
  z.number().int().positive().max(maximum).default(initial);

/** Explicit read/retention budgets; these are resource bounds, not SWF limits. */
export const analyzeFlashArtifactInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute local regular SWF file to acquire",
  ),
  max_file_bytes: bytes(128 * 1024 * 1024, 32 * 1024 * 1024).describe(
    "Maximum acquired source bytes; also subject to heap admission",
  ),
  max_decoded_bytes: bytes(128 * 1024 * 1024, 32 * 1024 * 1024).describe(
    "Maximum normalized FWS bytes, including its eight-byte header",
  ),
  max_tags: bytes(1_000_000, 100_000).describe(
    "Maximum examined tag occurrences across root and sprite streams, including End",
  ),
  max_nesting: bytes(256, 32).describe(
    "Maximum nested DefineSprite depth; root is depth zero",
  ),
  offset: count
    .default(0)
    .describe(
      "Zero-based first tag occurrence delivered in depth-first stream order",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(1024)
    .default(32)
    .describe(
      "Maximum delivered tag rows; the complete inventory is still examined",
    ),
  capture_raw: z
    .boolean()
    .default(false)
    .describe(
      "Retain content-addressed source, normalized and ABC base64 blobs in Evidence raw_result",
    ),
  max_raw_bytes: bytes(256 * 1024 * 1024, 64 * 1024 * 1024).describe(
    "Maximum deduplicated base64 encoded bytes, checked before encoding",
  ),
});
export type FlashArtifactInput = z.infer<
  typeof analyzeFlashArtifactInputSchema
>;

const rectangle = z.strictObject({
  x_min: z.number(),
  x_max: z.number(),
  y_min: z.number(),
  y_max: z.number(),
});
export const flashTagSchema = z.strictObject({
  index: count,
  code: z.number().int().min(0).max(1023),
  name: z.string(),
  stream_id: z.literal("normalized-fws"),
  parent_tag_index: count.nullable(),
  depth: count,
  start: count,
  payload_start: count,
  end: count,
  payload_sha256: digest,
  sprite: z.strictObject({ id: count, declared_frames: count }).nullable(),
  binary_data: z
    .strictObject({ id: count, data_start: count, data_sha256: digest })
    .nullable(),
  abc: z
    .strictObject({
      kind: z.enum(["DoABC", "DoABCDefine"]),
      flags: count.nullable(),
      name: z.string().nullable(),
      start: count,
      bytes: count,
      sha256: digest,
    })
    .nullable(),
});
export const flashArtifactSchema = z.strictObject({
  artifact: z.strictObject({
    path: absoluteLocalPathStringSchema,
    sha256: digest,
    bytes: count,
    signature: z.enum(["FWS", "CWS"]),
  }),
  normalized_stream: z.strictObject({
    id: z.literal("normalized-fws"),
    sha256: digest,
    bytes: count,
    offset_basis: z.literal("normalized-stream-end-exclusive"),
  }),
  header: z.strictObject({
    version: count,
    declared_length: count,
    rect_twips: rectangle,
    rect_logical_pixels: rectangle,
    frame_rate_raw: count,
    frame_rate: z.number().nonnegative(),
    declared_frames: count,
    tags_start: count,
  }),
  inventory: z.strictObject({
    tags: count,
    top_level_tags: count,
    sprite_streams: count,
    opaque_binary_data: count,
    avm1_blocks: count,
    abc_occurrences: count,
    unique_abc_blobs: count,
    by_code: z.array(z.strictObject({ code: count, count })),
  }),
  tags: z.strictObject({
    offset: count,
    limit: count,
    total: count,
    returned: count,
    has_more: z.boolean(),
    items: z.array(flashTagSchema),
  }),
  coverage: z.strictObject({
    header: z.literal("complete"),
    tag_framing: z.literal("complete"),
    sprite_tag_framing: z.literal("complete"),
    payload_semantics: z.literal("partial"),
    binary_data_contents: z.literal("uninterpreted"),
    abc_framing: z.literal("complete"),
    abc_classes_traits_methods: z.literal("uninterpreted"),
    avm1_actions: z.literal("uninterpreted"),
    decompiled_control_flow: z.literal("not-performed"),
    asset_conversion: z.literal("not-performed"),
    amf_and_network_behavior: z.literal("not-inspected"),
    runtime: z.literal("not-executed"),
  }),
  raw_capture: z.strictObject({
    status: z.enum(["not-requested", "captured"]),
    blobs: count,
    encoded_bytes: count,
  }),
  limitations: z.array(z.string()),
});
export type FlashArtifact = z.infer<typeof flashArtifactSchema>;
export type FlashTag = z.infer<typeof flashTagSchema>;

/** Content-addressed bytes live in raw_result rather than the compact tag page. */
export interface FlashArtifactObservation {
  readonly report: FlashArtifact;
  readonly rawResult?: {
    readonly blobs: {
      readonly sha256: string;
      readonly bytes: number;
      readonly base64: string;
    }[];
    readonly source_blob: string;
    readonly normalized_blob: string;
  };
}
