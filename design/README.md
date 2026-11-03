# WebOps workspace design

Open `webops-workspace.html` directly in a browser. This is a self-contained HTML/CSS/JavaScript design deliverable; no build, server, fonts, or network dependencies are required.

## Explore

- Overview: compact project summary, triage queue, explicit coverage limitations.
- Issues / Pages / Skipped URLs / Event log: replacement pagination, search, filter, and sort. Six rows on desktop, three on initial mobile load; page size is adjustable.
- Issue title: detail drawer, editable fields, observation, suggested fix, revision history, Markdown download.
- View proof: illustrative proof viewer, with explicit unavailable screenshot state.
- Reports: frozen sample snapshots unaffected by current issue edits.
- Run scan: local progress simulation; cancel preserves event history for the session.
- Scan policy: read-only approved-origin and crawl-limit preview.
- Design notes: rationale and production component mapping.

Edits are stored in this browser under `webops-design-v1`. Clear that localStorage key to reset. All data is illustrative. The prototype does not run scans, authenticate users, contact websites, or persist actual evidence. Production scan limits, authorized citation routes, version conflicts, retention states, and server pagination remain backend integration requirements. Simulated scan events are session-only; the production UI must replay persisted events after refresh.

## Design decisions

A quiet neutral palette and one green action color keep attention on content. Priority is encoded by both text and color. Summary → dataset → issue → proof provides progressive disclosure. Avoid an unsupported health score and distinguish completed scans with policy exclusions from incomplete runs.

Desktop uses a persistent navigation rail and bounded table beside scan context. Mobile uses stacked issue rows, a collapsible context section, and a navigation drawer. Native dialogs provide focus containment and Escape-to-close. Current board edits and historical scan facts remain distinct.

## Validation

Checked with local Chromium: pagination, search, inline edits, edits across reload, immutable sample report, proof dialogs, dataset views, simulation/cancel, and viewport overflow at 320, 390, 768, 1024, and 1440 pixels. `desktop-preview.png` and `mobile-preview.png` are previews of the deliverable.
