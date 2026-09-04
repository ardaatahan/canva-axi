# Project agent memory

- `README.md` is the authoritative command, OAuth, safety-gate, official-doc,
  and UNRESOLVED reference. Keep it aligned with `src/commands/canva.ts`.
- Canva Connect paths and payloads must be verified against
  `https://www.canva.dev/sources/connect/api/latest/api.yml`; never infer an
  endpoint from Canva MCP or internal APIs.
- All API credentials come from `CANVA_ACCESS_TOKEN`. The official quickstart
  names `CANVA_CLIENT_ID` and `CANVA_CLIENT_SECRET`, but this CLI intentionally
  does not perform interactive OAuth or refresh-token storage.
- Every mutation must reject without `--confirm` before network access. Reads
  are ungated. Exit codes are 0 success, 1 usage/config/validation, and 2
  runtime/API.
- Tests must mock HTTP and run without secrets. Validate changes with
  `npm test`, `npm run typecheck`, and `npm run skill:check`.

## UNRESOLVED

- Brand-template and existing-design copy creation and design-page metadata are
  preview APIs that Canva says public integrations cannot use for review.
- Canva Connect has no general element-update endpoint. Phase A only updates
  text/image fields preconfigured in a design's Autofill dataset.
- OAuth login/refresh, non-image exports, brand-template Autofill creation,
  uploads, and other Connect resource families are outside Phase A.
