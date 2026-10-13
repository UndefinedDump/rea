import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDocumentationPages } from "./lib/documentation-page-checks.mjs";

// Public route baseline before categorization, including upstream signal recordings.
// This fixture is independent of the navigation/rewrite implementation.
const routes = `
adb-device-analysis android-analysis apktool-resource-analysis apple-application-analysis
binary-diagnostics browser-observation browser-scenario-contract cli client-configuration
client-verification electron-observation evm-bytecode firmware-analysis flutter-analysis
frida-instrumentation ghidra-dos ghidra-mips ghidra-nativeaot ghidra-provider ghidra-psp
ghidra-riscv go-binaries harmony-analysis ida-provider installation
javascript-application-graph javascript-application-workflows javascript-artifact-reconstruction
javascript-recovery javascript-runtime-observation javascript-runtime-reconciliation
jeb-analysis managed-code-analysis mcp-contracts mcp-prompts migration-6.2
native-investigation packet-captures process-capture raw-binary reconstruction-obligation-ledgers
reconstruction-readiness recorded-crashes releasing roadmap signal-recordings sqlite-databases
testing tool-design wasm-artifacts web-network-captures web-runtime web-source-location
website-module-trace website-script-export windows-ghidra-p0
`
  .trim()
  .split(/\s+/u);
assert.equal(routes.length, 56);
assert.equal(new Set(routes).size, routes.length);

const documentation = resolve(
  process.argv[2] ?? fileURLToPath(new URL("../docs/", import.meta.url)),
);
console.log(
  JSON.stringify(await verifyDocumentationPages(documentation, routes)),
);
