# CR-43 matrix review

- Final renderer matrix: 27 deterministic scenarios.
- Every output SHA changed because the shared output document contains the new print-only CSS.
- For all 27 captured HTML files, removing exactly the two new `.content-page` print rules and their comment restored the prior canonical hashes: 27/27 matched, zero unexplained diffs.
- The only source delta in the report renderer is that CSS block; no report text, model, evidence, scores, links, priorities, or identity behavior changed.
- Updated `canonicalRenderGolden` to the exact current 27 outputs so CR-43 continues to detect any future renderer drift.
- Matrix outputs are in the temporary `%TEMP%\prysm-cr43-2e5bde5-refresh-0921` path for this run; they contain only deterministic report fixture output and are not included in the repository.
