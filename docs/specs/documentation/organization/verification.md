# Verification after upstream integration

## Review follow-up

Integrated upstream 9928f357f and resolved current README, skill, sidebar, managed
anchor and CI-plan conflicts while preserving new Qlog/PCAP content and the
current CI qualification rules. The additional PCAP guide has its data-domain
owner and unchanged public route. Two newly added relative links were corrected
for their moved physical sources.

Review #4255489645 identified that the legacy inventory did not cover new pages.
The checker now discovers all output HTML independently of that baseline and
uses parse5 for links, image sources, IDs and edit-footer attributes. It verifies
physical source paths and realpath containment. Home and 404 pages have their
links checked without requiring an edit footer.

The actual build passed for 56 legacy routes, all 67 HTML pages, 65 physical edit
sources and 581 distinct internal targets/anchors. All six static tasks,
architecture guards and documentation-fact checks passed. 142 regressions passed
across six files, including positive control output and intended failures for a
broken link, missing anchor, wrong source and escaped source on new spec pages.
The checker regression suite runs in documentation CI; both the script and its
helper select that lane through the production CI planner.

## Earlier integration evidence

Integrated upstream c462a4ebd, preserving its new signal-recording guide, managed
summary documentation, current translations and unknown-head pagination contract.

- Documentation facts and README consistency checks passed.
- Production VitePress build passed.
- Independent built-HTML verification passed for 56 stable public routes,
  56 physical source-edit links and 507 distinct internal file/anchor targets.
- The new regression caught a doubled catalog base path and a missing historical
  managed/native fragment. Both were corrected without weakening assertions.
- All six static tasks and architecture guards passed.
- 167 relevant catalog, release, documentation, signal-MCP, target-framing,
  managed-summary, Worker-URL CLI and CI-planner regression tests passed across
  ten files. CLI runs need process-table access for actual ownership/cleanup
  verification; restricted execution failed with spawn EPERM, while the normal
  host run passed without changing timeouts or assertions.
- After the subsequent upstream advance, 14 tests across unknown-head pagination,
  workflow replay and target-content framing passed. Static checks, documentation
  facts and all 56 published routes passed again against that base.
- Documentation CI and the manual build require the built-page verifier.
  An actual CI-planner regression ensures edits to the verifier select that lane.

The renderer treats physical docs/public references as site-root assets.
The managed guide retains its original heading and an explicit historical fragment
alias. External HTTP targets were not fetched; this verification concerns actual
local production HTML and source files.
