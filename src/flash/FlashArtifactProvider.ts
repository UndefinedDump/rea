import { getHeapStatistics } from "node:v8";
import type { FlashArtifactPort } from "../application/flash/FlashArtifactPort.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type { FlashArtifactInput } from "../domain/flash/flashArtifact.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { translateArtifactFailure } from "../artifacts/ArtifactOperationFailure.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import {
  artifactFilePrimaryFailure,
  ArtifactFileCancelled,
  ArtifactFileCleanupFailure,
  bindArtifactFileCleanup,
  artifactFileCancellationCause,
} from "../artifacts/ArtifactFileOperation.js";
import {
  readStableArtifact,
  type StableArtifactFileSystem,
} from "../artifacts/readStableArtifact.js";
import { err, ok } from "../domain/result.js";
import { FLASH_OPERATION, checkFlashCancellation } from "./SwfFraming.js";
import { inspectSwfBytes } from "./SwfTagInventory.js";

export const FLASH_ARTIFACT_PROVIDER_IDENTITY = {
  id: "flash-artifact",
  name: "REA static SWF reader",
  version: "1",
} as const;

/** Source files remain owned through finalization; no player, process or network. */
export class FlashArtifactProvider implements FlashArtifactPort {
  readonly identity = FLASH_ARTIFACT_PROVIDER_IDENTITY;
  readonly #resources = new ArtifactResourceScope();
  #busy = false;
  constructor(private readonly fileSystem?: StableArtifactFileSystem) {}
  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      const failure = new ProviderCleanupError(
        this.identity.id,
        this.#resources.cleanupResources,
        {},
        { cause, operation: FLASH_OPERATION },
      );
      bindArtifactFileCleanup(cause, failure);
      throw failure;
    }
  }
  async inspect(input: FlashArtifactInput, options?: ExecutionOptions) {
    if (this.#busy)
      return err(
        new AnalysisResourceConstraintError(
          FLASH_OPERATION,
          "capacity",
          "One SWF inspection is already active",
          { concurrent_inspections: 1 },
          { retryable: true },
        ),
      );
    this.#busy = true;
    const maximum = Math.min(
      input.max_file_bytes,
      Math.max(1, Math.floor(getHeapStatistics().total_available_size / 12)),
    );
    let sourceCapture:
      | {
          kind: "file-snapshot-hash";
          path: string;
          sha256: string;
          bytes: number;
        }
      | undefined;
    try {
      return await this.#resources.run(async () => {
        const source = await readStableArtifact(
          input.path,
          maximum,
          options?.signal,
          this.fileSystem,
          this.#resources,
        );
        sourceCapture = {
          kind: "file-snapshot-hash",
          path: input.path,
          sha256: source.sha256,
          bytes: source.bytes.length,
        };
        const result = await inspectSwfBytes(
          source.bytes,
          source.sha256,
          input,
          options?.signal,
        );
        checkFlashCancellation(options?.signal);
        return ok(result);
      });
    } catch (cause: unknown) {
      const physical = artifactFilePrimaryFailure(cause);
      const outcome =
        cause instanceof ArtifactFileCleanupFailure
          ? cause.fileCleanupFailure.outcome
          : cause instanceof ArtifactFileCancelled
            ? cause.fileCancellation.outcome
            : undefined;
      const captured: unknown =
        outcome?.kind === "completed" ? outcome.value : undefined;
      if (
        typeof captured === "object" &&
        captured !== null &&
        "sha256" in captured &&
        typeof captured.sha256 === "string" &&
        "bytes" in captured &&
        Buffer.isBuffer(captured.bytes)
      )
        sourceCapture = {
          kind: "file-snapshot-hash",
          path: input.path,
          sha256: captured.sha256,
          bytes: captured.bytes.length,
        };
      const retained =
        sourceCapture === undefined
          ? {}
          : { partialObservation: sourceCapture };
      let failure =
        physical instanceof AnalysisCancelledError
          ? new AnalysisCancelledError(FLASH_OPERATION, {
              cause: physical.cause,
              ...retained,
            })
          : physical instanceof AnalysisError
            ? physical
            : physical instanceof ArtifactReaderFailure &&
                physical.reason === "limit"
              ? new AnalysisResourceConstraintError(
                  FLASH_OPERATION,
                  maximum < input.max_file_bytes ? "memory" : "file-size",
                  physical.message,
                  {
                    max_file_bytes: input.max_file_bytes,
                    admitted_file_bytes: maximum,
                  },
                  { cause, retryable: false },
                )
              : physical instanceof ArtifactReaderFailure &&
                  physical.reason === "cancelled"
                ? new AnalysisCancelledError(FLASH_OPERATION, {
                    cause: artifactFileCancellationCause(physical),
                    ...retained,
                  })
                : physical instanceof ArtifactReaderFailure
                  ? translateArtifactFailure(FLASH_OPERATION, physical)
                  : new ProviderAdapterError(
                      this.identity.id,
                      FLASH_OPERATION,
                      {
                        cause: physical,
                        ...retained,
                      },
                    );
      if (
        sourceCapture !== undefined &&
        failure.partialObservation === undefined
      )
        failure.partialObservation = sourceCapture;
      if (cause instanceof ArtifactFileCleanupFailure) {
        const outcome = cause.fileCleanupFailure.outcome;
        const cleanup = new ProviderCleanupError(
          this.identity.id,
          this.#resources.cleanupResources,
          {},
          {
            cause,
            operation: FLASH_OPERATION,
            ...retained,
          },
        );
        bindArtifactFileCleanup(cause, cleanup);
        failure =
          outcome.kind === "completed"
            ? cause.fileCleanupFailure.completionCancellation === undefined
              ? cleanup
              : analysisErrorWithCleanupFailure(
                  new AnalysisCancelledError(FLASH_OPERATION, {
                    cause:
                      cause.fileCleanupFailure.completionCancellation.reason,
                    ...retained,
                  }),
                  cleanup,
                  FLASH_OPERATION,
                )
            : analysisErrorWithCleanupFailure(
                failure,
                cleanup,
                FLASH_OPERATION,
              );
      }
      bindArtifactFileCleanup(cause, failure);
      return err(failure);
    } finally {
      this.#busy = false;
    }
  }
}
