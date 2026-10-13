import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { executeWorkflowFixture } from "../../support/workflowGit.js";

const fixture = async () => {
  const root = await createTestTempDirectory("rea-doc-page-checks-");
  const output = join(root, ".vitepress/dist");
  await mkdir(output, { recursive: true });
  const setPage = async (route: string, source: string, content = "") => {
    const sourcePath = join(root, source);
    const page = join(output, route + ".html");
    await mkdir(dirname(sourcePath), { recursive: true });
    await mkdir(dirname(page), { recursive: true });
    await writeFile(sourcePath, "# Owned source\n");
    await writeFile(
      page,
      `<a class="edit-link-button" href="https://github.com/morluto/rea/edit/main/docs/${source}">Edit</a>${content}`,
    );
  };
  // Preserve the independent legacy inventory; new pages are not added to it.
  const legacy =
    `adb-device-analysis android-analysis apktool-resource-analysis apple-application-analysis binary-diagnostics browser-observation browser-scenario-contract cli client-configuration client-verification electron-observation evm-bytecode firmware-analysis flutter-analysis frida-instrumentation ghidra-dos ghidra-mips ghidra-nativeaot ghidra-provider ghidra-psp ghidra-riscv go-binaries harmony-analysis ida-provider installation javascript-application-graph javascript-application-workflows javascript-artifact-reconstruction javascript-recovery javascript-runtime-observation javascript-runtime-reconciliation jeb-analysis managed-code-analysis mcp-contracts mcp-prompts migration-6.2 native-investigation packet-captures process-capture raw-binary reconstruction-obligation-ledgers reconstruction-readiness recorded-crashes releasing roadmap signal-recordings sqlite-databases testing tool-design wasm-artifacts web-network-captures web-runtime web-source-location website-module-trace website-script-export windows-ghidra-p0`.split(
      " ",
    );
  await Promise.all(
    legacy.map((route) => setPage(route, `guides/${route}.md`)),
  );
  await setPage(
    "development/documentation",
    "development/documentation.md",
    '<h2 id="feature-lifecycle">Lifecycle</h2>',
  );
  await setPage(
    "specs/index",
    "specs/README.md",
    '<a href="/rea/development/documentation.html#feature-lifecycle">Lifecycle</a>',
  );
  await writeFile(
    join(output, "index.html"),
    '<a href="/rea/specs/">Specifications</a>',
  );
  await writeFile(join(output, "404.html"), '<a href="/rea/">Home</a>');
  return { root, output, setPage };
};

const verify = (root: string) =>
  executeWorkflowFixture(process.execPath, [
    fileURLToPath(
      new URL(
        "../../../scripts/verify-documentation-routes.mjs",
        import.meta.url,
      ),
    ),
    root,
  ]);

it("checks new spec pages and home/404 links alongside the legacy baseline", async () => {
  const { root } = await fixture();
  const result = await verify(root);
  expect(JSON.parse(result.stdout)).toMatchObject({
    legacy_routes: 56,
    published_html_pages: 60,
    physical_edit_links: 58,
  });
});

it.each([
  "missing-anchor",
  "missing-file",
  "wrong-edit-source",
  "escaped-edit-source",
] as const)(
  "rejects %s on a new spec page outside the legacy inventory",
  async (kind) => {
    const { root, output, setPage } = await fixture();
    if (kind === "missing-anchor")
      await setPage(
        "specs/index",
        "specs/README.md",
        '<a href="/rea/development/documentation.html#absent">Broken</a>',
      );
    else if (kind === "missing-file")
      await setPage(
        "specs/index",
        "specs/README.md",
        '<a href="/rea/specs/absent.html">Broken</a>',
      );
    else {
      const target =
        kind === "wrong-edit-source" ? "guides/cli.md" : "../outside.md";
      await writeFile(
        join(output, "specs/index.html"),
        `<a class="edit-link-button" href="https://github.com/morluto/rea/edit/main/docs/${target}">Edit</a>`,
      );
    }
    const failure = {
      "missing-anchor": "missing rendered anchor",
      "missing-file": "absent.html",
      "wrong-edit-source": "edit link names another source",
      "escaped-edit-source": "edit source escaped documentation root",
    }[kind];
    await expect(verify(root)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(failure),
    });
  },
);
