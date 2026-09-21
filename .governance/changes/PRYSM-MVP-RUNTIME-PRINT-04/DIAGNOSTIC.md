# Diagnostic Evidence

- Candidate `0ec242c34de862e9e8d835b4f615331de57643b7` passed authenticated Chromium through login, dashboard, exact audit, all seven report views, refresh, session continuity, and dashboard return.
- The exact persisted report artifact SHA was `8e4131d0ed0eba45aa54901a66cee3a99e390e9c8fdf5329d67ec9932c7e0de9`; rendered PDFs contained no sparse physical pages after the content-page compaction repair.
- Visual inspection of each contact sheet showed `← Back to Dashboard` in the PDF header. The exact report route injects that link without the existing `no-print` class.
- The worker renderer print contract already hides `.no-print` elements. Marking the injected navigation anchor `no-print` is the smallest generic route-boundary correction; screen behavior remains unchanged.
- Classification: `APPLICATION_DEFECT` at the report-delivery presentation wrapper, not the stored report, content, browser harness, or auth path.
