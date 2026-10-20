# Implementation plan

1. Define strict input/output schemas with byte/capacity budgets, normalized
   coordinate basis, paged tag observations and per-facet coverage. Reference
   the public SWF 19 specification and Ruffle's framing implementation; do not
   copy their source or infer runtime behavior from names/string literals.
2. Implement a bounded buffer parser after async capped zlib decoding. Inspect
   stream termination and consumed compressed bytes; require the declared
   normalized extent. Use an explicit stack for sprite tag streams and yield
   cooperatively during long scans. Count every framed occurrence, including
   End; retain only requested page rows and unique ABC commitments.
3. Reuse readStableArtifact and ArtifactResourceScope for acquisition/cleanup,
   and preserve typed primary/cleanup/cancellation outcomes. The application
   service validates the producer report and creates source-bound Evidence;
   composition owns the adapter and CLI/server lifetimes close it.
4. Register one named contract and dedicated CLI command. Default output is a
   compact page; optional raw_result records captured stream/blob bytes keyed
   by digest. Explicitly document unsupported compression and semantics.
5. Use source-owned synthetic movies through public CLI/MCP for equivalence,
   duplicate/nested occurrences, malformed framing and budgets. Add controlled
   file-finalization regressions where public OS failures are not reproducible.
   Measure token estimates, elapsed/CPU and individual peak RSS; distinguish
   process-family and live-model costs that are not measured. Run relevant
   source/static/catalog/docs and packaged-runtime checks.

## Executed validation

On upstream `ccc7da309`, Node 24.18.0/npm 11.16.0, darwin/arm64:

- 44 tests passed across source-owned SWF framing/lifecycle, actual CLI/MCP,
  CLI tool coverage, effects and the canonical product catalog.
- `npm run check` and `npm run docs:check` passed, including architecture guards
  and five README consistency tests. No target code was executed.
- Package install/update, CLI/MCP discovery and setup/uninstall were verified;
  the catalog contains 213 tools and six prompts. Verified process-lineage
  completion is required before package verification reports success.
- Samples are synthetic containers with opaque ABC bytes, not evidence of valid
  ABC semantic decoding, historical publisher compatibility or runtime behavior.
  ZWS/LZMA, SWF versions after 19 and the issue's other domains remain outside
  this milestone. Actual Windows/Linux host execution was not performed.

A preliminary cost probe on the preceding `1629266e3` worktree used a source-owned
1,967-byte CWS with 1,001 framed tag occurrences and a 32-row delivered page.
Two fresh CLI processes took 0.850/0.939 seconds, with user CPU 0.99/1.16 seconds,
system CPU 0.10/0.11 seconds, individual peak RSS 376,569,856/363,593,728 bytes,
and 3,934 estimated output tokens each. The separate initialized MCP call with
raw capture took 4.693 seconds; estimates were 4,867 tokens for that operation's
schema, 53 for its request, and 16,705 for the full response. These tokenx
estimates precede the final option descriptions and upstream update; they are
not final-release costs or a live model's whole-task usage. OS/JIT cache state
was uncontrolled, so the samples do not establish cold/warm performance. CLI
and MCP selections differed and their times are not comparable. No pre-existing
equivalent Flash workflow, process-family memory peak or speed improvement was
measured. Source immutability and positively verified empty process lineage
were checked before the probe reported success.
