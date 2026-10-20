import { z } from "incur";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { createFlashArtifactService } from "../composition/flash.js";
import { analyzeFlashArtifactInputSchema } from "../domain/flash/flashArtifact.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import { logCliCommand } from "../cliLogging.js";

export const registerFlashCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  const { path: _path, ...options } = analyzeFlashArtifactInputSchema.shape;
  cli.command(CLI_COMMANDS.analyzeFlashArtifact, {
    description:
      "Inspect static FWS/CWS SWF framing and ABC occurrences; never executes Flash",
    args: z.object({ path: z.string().describe("Local SWF artifact") }),
    options: z.object(options),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.analyzeFlashArtifact, async () => {
          const service = createFlashArtifactService();
          return finishAnalysisCommand(
            () =>
              service.inspect(
                { path: absoluteCallerPath(args.path), ...options },
                { signal },
              ),
            service,
            "flash-artifact",
            "analyze_flash_artifact",
            signal,
          );
        }),
      ),
  });
};
