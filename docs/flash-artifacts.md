# Static Flash/SWF evidence

Use `analyze_flash_artifact` or the CLI to inspect a caller-selected SWF without
launching a Flash player, running ActionScript or contacting a network service:

```bash
rea analyze-flash-artifact /absolute/path/movie.swf --json
rea analyze-flash-artifact /absolute/path/movie.swf --offset 32 --limit 16 --json
rea analyze-flash-artifact /absolute/path/movie.swf --capture_raw --json
```

The equivalent MCP input is:

```json
{
  "path": "/absolute/path/movie.swf",
  "offset": 0,
  "limit": 32,
  "capture_raw": false
}
```

## Supported framing and identities

This first milestone supports FWS (uncompressed) and CWS (zlib), SWF versions
1–19. ZWS/LZMA and later versions return a typed unsupported-target error.
Malformed headers, inconsistent lengths, missing End/name terminators and
trailing compressed bytes fail rather than producing a successful empty report.

Evidence binds the acquired file's path, byte count and SHA-256. The report
separately identifies a normalized FWS stream. Equivalent FWS and CWS movies
have different source digests and matching normalized digests. Tag ranges are
end-exclusive offsets in that normalized stream, including its eight-byte
header; they are never physical offsets into compressed CWS bytes.

The header retains RECT coordinates in twips and derives logical pixels by
dividing by 20. Raw frame-rate units and the derived rate remain separate.
An inventory counts every framed tag occurrence, including End tags, nested
DefineSprite streams, ABC blocks and opaque DefineBinaryData payloads. Unknown
tag codes retain their code and payload digest without an invented meaning.

## Delivery and coverage

The default page contains at most 32 tag rows. `offset` and `limit` select delivery
while the inventory denominator still covers the entire successfully framed
movie. Each row has a payload SHA-256 and normalized coordinates. ABC occurrences
retain flags/name where present, byte count and digest; identical ABC bytes share
a digest while retaining separate occurrence coordinates and parent tag indices.

`capture_raw: true` adds content-addressed base64 source, normalized and unique
ABC blobs in Evidence `raw_result`. It does not write files. Without that option,
digests are commitments rather than persisted byte captures. MCP retains the
returned Evidence in its session bundle; pages are separate observations and
reacquire the file, so compare subject digests if the file could change.

Complete header/tag/ABC **framing** does not establish complete payload semantics.
ABC classes, traits and methods, AVM1 instructions and embedded binary contents
remain uninterpreted. No decompilation, asset conversion/export, AMF/SOL parsing,
URL discovery or runtime observation is performed. Captured strings and bytes
are untrusted target data, never instructions to an agent.

## Resource and lifetime controls

| Input               | Default | Maximum   |
| ------------------- | ------- | --------- |
| `max_file_bytes`    | 32 MiB  | 128 MiB   |
| `max_decoded_bytes` | 32 MiB  | 128 MiB   |
| `max_tags`          | 100,000 | 1,000,000 |
| `max_nesting`       | 32      | 256       |
| `limit`             | 32      | 1,024     |
| `max_raw_bytes`     | 64 MiB  | 256 MiB   |

These are caller-selectable resource budgets, not format limits. `max_raw_bytes`
counts deduplicated base64 encoded bytes before encoding. Heap admission also
accounts for representation expansion and unique ABC commitments. Exhaustion
returns a typed resource constraint; no partial inventory is called complete.

A stable regular-file acquisition checks descriptor and pathname identity,
retains source facts through cancellation/finalization, and owns failed closure
until retry. The operation does not require an active native target or engine.

## References and verification scope

Framing follows the public [SWF 19 specification](https://open-flash.github.io/mirrors/swf-spec-19.pdf),
with [Open Flash's format documentation](https://open-flash.github.io/documentation/swf/swf/)
and [Ruffle's reader](https://github.com/ruffle-rs/ruffle/blob/master/swf/src/read.rs)
as cross-checks. Tests use source-owned synthetic FWS/CWS movies through the
actual CLI/MCP adapters, plus controlled file-finalization failures. They do not
establish compatibility with every historical publisher, LZMA stream, ABC
semantic dialect or runtime. Broader work remains tracked in
[issue #3614](https://github.com/morluto/rea/issues/3614).
