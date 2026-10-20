import { createHash } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { parseEvidence } from "../../src/domain/evidence.js";
import { flashArtifactSchema } from "../../src/domain/flash/flashArtifact.js";
import { flashMovie } from "../fixtures/flash.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "exposes matching static SWF Evidence through the built CLI and same-session MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-flash-cli-");
    const path = join(root, "movie.swf");
    const bytes = flashMovie(undefined, true);
    await writeFile(path, bytes);
    const command = await cli.run({
      arguments: ["analyze-flash-artifact", path, "--capture_raw", "--json"],
    });
    expect(command.exitCode, command.stderr || command.stdout).toBe(0);
    const cliEvidence = parseEvidence(command.json);
    const { call } = await connectLocalToolsMcp();
    const response = await call("analyze_flash_artifact", {
      path,
      capture_raw: true,
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const mcpEvidence = parseEvidence(response.structuredContent);
    expect(mcpEvidence.normalized_result).toEqual(
      cliEvidence.normalized_result,
    );
    expect(mcpEvidence.raw_result).toEqual(cliEvidence.raw_result);
    expect(mcpEvidence.subject?.digest?.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(response._meta).toMatchObject({
      provenance: { untrusted_content: true, source: "analysis_target" },
    });
    const bundle = await call("get_evidence_bundle", {});
    expect(JSON.stringify(bundle.structuredContent)).toContain(
      mcpEvidence.evidence_id,
    );
    const page = await call("analyze_flash_artifact", {
      path,
      offset: 2,
      limit: 1,
    });
    const report = flashArtifactSchema.parse(
      parseEvidence(page.structuredContent).normalized_result,
    );
    expect(report.tags.items).toHaveLength(1);
    expect(report.tags.items[0]!.index).toBe(2);
    expect(report.coverage).toMatchObject({
      abc_classes_traits_methods: "uninterpreted",
      runtime: "not-executed",
    });
    expect(await readFile(path)).toEqual(bytes);
  },
);

cliTest(
  "preserves typed unsupported compression and capacity failures through both adapters",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-flash-errors-");
    const path = join(root, "movie.swf");
    const bytes = flashMovie();
    bytes.write("ZWS");
    await writeFile(path, bytes);
    const command = await cli.run({
      arguments: ["analyze-flash-artifact", path, "--json"],
    });
    expect(command.exitCode).toBe(1);
    expect(JSON.stringify(command.json)).toContain("unsupported_target");
    const { call } = await connectLocalToolsMcp();
    expect(
      parseMcpToolError(await call("analyze_flash_artifact", { path })),
    ).toMatchObject({ error: { category: "unsupported_target" } });
    await writeFile(path, flashMovie());
    expect(
      parseMcpToolError(
        await call("analyze_flash_artifact", { path, max_tags: 1 }),
      ),
    ).toMatchObject({
      error: { code: "resource_constraint", retryable: false },
    });
    const valid = await call("analyze_flash_artifact", { path });
    expect(valid.isError).not.toBe(true);
  },
);
