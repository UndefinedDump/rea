# Static SWF container evidence

Issue: https://github.com/morluto/rea/issues/3614

This implements the first execution-free milestone proposed in
https://github.com/morluto/rea/issues/3614#issuecomment-6178556878.

## Requirements

Add `analyze_flash_artifact` to CLI/MCP without requiring an active native target.
Read a caller-selected local regular file through the existing stable artifact
and cleanup owners. Parse FWS and strictly decode CWS, bounding input, decoded
bytes, tags and sprite nesting. Recognized ZWS compression and versions outside
the implemented SWF 1–19 framing return typed unsupported failures.

Keep acquired source SHA-256 separate from the canonical FWS stream SHA-256.
Every tag/ABC occurrence names the normalized stream and uses end-exclusive
stream offsets, never alleged physical CWS offsets. Observe RECT values in
twips and derive logical pixels by dividing by 20. Validate file length,
frame-header extent, short/long tag headers, End tags, DoABC flags and its
terminated name. Walk nested DefineSprite streams with bounded explicit
ownership; identify DefineBinaryData payloads without silently parsing them as
another movie.

Report a compact caller-selected tag page with exact inventory counts and
separate container, ABC-capture, AVM1, ABC-semantic, asset and runtime coverage.
Capturing an ABC block does not establish its classes, methods or decompilation.
Preserve tag payload commitments before interpreting known framing. Optional
raw capture retains source/normalized streams and deduplicated ABC blobs by
digest; repeated occurrences keep distinct coordinates. Never execute scripts,
launch an emulator, fetch URLs or export assets.

## Acceptance

- Equivalent FWS/CWS inputs have different source identities but identical
  normalized identities, coordinates and tag inventories.
- CLI and same-session MCP return validated Evidence with a matching subject.
- Bad lengths/ranges, truncated framing, missing DoABC terminators, trailing
  compressed input and exhausted budgets produce typed failures.
- Duplicate ABC payloads preserve both occurrences and one captured blob;
  nested sprites and opaque binary data retain distinct coverage.
- Paging never reclassifies uninterpreted content as complete. Cancellation,
  file mutation and failed cleanup preserve the canonical owner contracts.

## Outside this milestone

LZMA decoding, ABC constant-pool/class/method interpretation, AVM1/AVM2
decompilation, asset conversion/export, AMF/SOL readers, AIR wrappers and Ruffle
execution require their own domain specs and verification. This PR references
the broader issue rather than closing those independent capabilities.
