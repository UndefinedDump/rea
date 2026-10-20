import { FlashArtifactService } from "../application/flash/FlashArtifactService.js";
import { FlashArtifactProvider } from "../flash/FlashArtifactProvider.js";

/** Construction acquires no files; CLI/MCP own the same inert reader lifetime. */
export const createFlashArtifactService = (): FlashArtifactService =>
  new FlashArtifactService(new FlashArtifactProvider());
