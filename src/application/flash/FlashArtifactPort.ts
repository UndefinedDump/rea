import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type {
  FlashArtifactInput,
  FlashArtifactObservation,
} from "../../domain/flash/flashArtifact.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Result } from "../../domain/result.js";

/** One static source snapshot and its explicitly scoped SWF observations. */
export interface FlashArtifactPort {
  readonly identity: ProviderIdentity;
  inspect(
    input: FlashArtifactInput,
    options?: ExecutionOptions,
  ): Promise<Result<FlashArtifactObservation, AnalysisError>>;
  close(): Promise<void>;
}
