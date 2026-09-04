---
name: canva-axi
description: "AXI-compliant Canva design and slideshow operations through the official Connect API"
---

# canva-axi

AXI-compliant Canva design and slideshow operations through the official Connect API (AXI spec axi/1.0-2026-07). Install from a checkout with `npm install && npm run build && npm link`; without linking, use `node bin/canva-axi.js`. Supply a Canva OAuth bearer access token only through `CANVA_ACCESS_TOKEN`.

```
capabilities[3]{group,operations,safety}:
 designs,"list,get,create,dataset,export-formats",create requires --confirm
 exports,"create,get,download",create/download require --confirm
 autofills,"update,get",dataset-backed update requires --confirm and eligible Canva plan
help[4]:
 canva-axi designs list
 canva-axi designs create --width 1080 --height 1920 --confirm
 canva-axi exports create <design-id> --format png --confirm
 canva-axi --help
```

Every command supports `--help`; data commands support `--json`. Mutations refuse before network access unless `--confirm` is present. Autofill updates work only for fields configured in the design dataset; inspect them first with `designs dataset`.

Exit codes: 0 success, 1 usage/configuration/validation error, 2 runtime or Canva API error. Default output is compact TOON on stdout.
