import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { FlashArtifactService } from "../application/flash/FlashArtifactService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { toolContract } from "../contracts/toolContracts.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";

export const registerFlashArtifactTools = (
  server: EvidenceMcpServer,
  service: FlashArtifactService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  admission?: WithAdmittedAnalysis,
): void => {
  const contract = toolContract("analyze_flash_artifact");
  const handler = createEvidenceToolHandler(
    server,
    (input, options) => service.inspect(input, options),
    logger,
    recordEvidence,
    admission,
  );
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    handler(contract),
  );
};
