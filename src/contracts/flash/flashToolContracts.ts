import {
  analyzeFlashArtifactInputSchema,
  flashArtifactSchema,
} from "../../domain/flash/flashArtifact.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
import type { ToolContract } from "../toolContractTypes.js";

export const FLASH_TOOL_CONTRACTS = [
  {
    name: "analyze_flash_artifact",
    ...toolContractMetadata("analyze_flash_artifact"),
    kind: "artifact-provider",
    description:
      "Inspect a local FWS/CWS SWF 1–19 container without executing Flash, ActionScript, Ruffle or other foreign code. Returns source identity, a separate normalized FWS stream identity, twips/logical-pixel frame metadata, complete bounded root/sprite tag framing and a selected tag page (32 rows by default). Rows use normalized end-exclusive offsets, never physical CWS offsets. DoABC flags/name and raw block commitments are captured; ABC classes/traits/methods, AVM1 actions, embedded binary data, asset semantics and AMF/network behavior remain uninterpreted. No decompilation, export, process or network. capture_raw optionally retains content-addressed source/normalized/ABC blobs in raw_result; otherwise hashes are commitments, not persisted captures. Explicit byte/tag/nesting/retention budgets fail with typed errors. ZWS/LZMA and other versions return typed unsupported failures. Paging limits delivery, never the inspected denominator.",
    inputSchema: analyzeFlashArtifactInputSchema,
    outputSchema: evidenceResultOf(flashArtifactSchema),
    examples: [
      {
        title: "Inspect a static SWF and its first tag page",
        input: { path: "/artifacts/movie.swf", offset: 0, limit: 32 },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
