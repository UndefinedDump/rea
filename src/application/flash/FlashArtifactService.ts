import type { FlashArtifactPort } from "./FlashArtifactPort.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import {
  analyzeFlashArtifactInputSchema,
  flashArtifactSchema,
} from "../../domain/flash/flashArtifact.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";

/** Shared Evidence and named input boundary; byte interpretation stays in the reader. */
export class FlashArtifactService {
  constructor(readonly provider: FlashArtifactPort) {}
  close(): Promise<void> {
    return this.provider.close();
  }
  async inspect(
    raw: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const input = analyzeFlashArtifactInputSchema.safeParse(raw);
    if (!input.success)
      return err(
        analysisInputErrorFromIssues(
          "analyze_flash_artifact",
          input.error.issues,
          raw,
        ),
      );
    const result = await this.provider.inspect(input.data, options);
    if (!result.ok) return result;
    const parsed = flashArtifactSchema.safeParse(result.value.report);
    if (
      !parsed.success ||
      parsed.data.artifact.path !== input.data.path ||
      parsed.data.tags.offset !== input.data.offset ||
      parsed.data.tags.limit !== input.data.limit ||
      parsed.data.raw_capture.status !==
        (input.data.capture_raw ? "captured" : "not-requested")
    )
      return err(
        new AnalysisOutputError(
          "analyze_flash_artifact",
          "SWF reader returned invalid facts or changed the caller's selection",
        ),
      );
    const report = parsed.data;
    return completeProviderEvidence(
      createEvidence(
        {
          path: report.artifact.path,
          sha256: report.artifact.sha256,
          format: "file",
        },
        this.provider.identity,
        {
          operation: "analyze_flash_artifact",
          parameters: input.data,
          result: report,
          ...(result.value.rawResult === undefined
            ? {}
            : { rawResult: result.value.rawResult }),
          confidence: "observed",
          limitations: report.limitations,
          locations: [{ kind: "artifact-path", path: report.artifact.path }],
        },
      ),
      options?.signal,
    );
  }
}
