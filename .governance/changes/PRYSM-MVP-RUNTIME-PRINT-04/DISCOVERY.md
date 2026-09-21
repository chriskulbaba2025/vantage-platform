# Discovery

- Owning boundary: authenticated Next.js report proxy at `app/audits/[auditId]/report/[...path]/route.ts`.
- Production-shaped flow: Cognito reviewer session → authoritative Vercel Preview → signed worker principal → isolated Railway staging/PostgreSQL and staging S3 → exact persisted audit/report → selected viewer → Chromium PDF.
- Exact audit: `6dca53ed-ae00-484c-bf77-b59c059eef51`.
- The dashboard return link is proxy UI chrome injected into approved report HTML; the report renderer already defines `.no-print` as hidden in print.
- Protected: authentication, authorization, tenant scoping, report object bytes/meaning, all browser navigation, production configuration, and provider usage.
