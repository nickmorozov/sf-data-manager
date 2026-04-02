# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

SF Data Manager is a Node.js CLI tool that wraps SFDMU (Salesforce Data Move Utility) to export/import Salesforce data. It reads object definitions from JSON config files in the consumer project, making it reusable across different Salesforce projects.

This repo is designed to be used as a **git submodule** in consumer projects. It is not standalone — it expects to be run from within a consumer project that has a `config/<operation>.json` file.

## Running

From the consumer project root:

```bash
node sf-data-manager/src/main.js export -s <source-org> --source-orgs 0001,0002 --verbose
node sf-data-manager/src/main.js import -t <target-org> --source-orgs 0001
node sf-data-manager/src/main.js list -s <source-org>
```

Options also accept env vars: `SOURCE_ALIAS`, `TARGET_ALIAS`, `SOURCE_SALES_ORGS`, `TARGET_SALES_ORGS` (loaded via dotenv).

No build step, no test suite, no linter configured. Pure CommonJS Node.js.

## Prerequisites

- Node.js >= 14.0.0
- Salesforce CLI (`sf`)
- SFDMU plugin (`sf plugins install sfdmu`)

## Architecture

### Data Flow

```
Export: Salesforce Org → SFDMU → CSV (tmp/) → JSON (data/)
Import: JSON (data/) → CSV (tmp/) → SFDMU → Salesforce Org
```

The JSON layer exists so exported data can be version-controlled (one file per record, named by external ID).

### Source Layout (`src/`)

All source code lives under `src/`. Root contains only `package.json`, docs, and license.

**Entry Point** — `src/main.js`
Commander.js CLI. Parses args, creates `Config`, creates `DataManager`, runs `init()` then `processData()`.

**Config** — `src/config/`

- `config.js` — `Config` class. Loads JSON config from consumer project's `config/<operation>.json`, validates CLI options, resolves paths, builds SFDMU `export.json` with `_`-prefixed metadata stripped. Getters expose filtered object lists: `referenceObjects`, `lookupObjects`, `junctionObjects`, `hierarchyObjects`.
- `constants.js` — Shared constants: `OPERATIONS`, `LOG_LEVELS`, `DEFAULT_TIMEOUT` (300s), placeholder slugs.

**Core** — `src/`

- `dataManager.js` — Orchestrator. Routes to single or multi-sales-org transfer. Pre-export: enriches queries via `_reference` org queries. Post-first-run: filters junctions via `_junction` parent CSVs and runs SFDMU again. Post-export: resolves `#N/A` values via `_lookup`/`_hierarchy` org queries. Handles two-step temporary-value imports and post-operation error analysis.
- `csvManager.js` — CSV parsing (with BOM support via `csv-parse`). Analyzes SFDMU error reports (`CSVIssuesReport.csv`, `MissingParentRecordsReport.csv`).
- `jsonConverter.js` — Bidirectional CSV↔JSON. Each record becomes a separate JSON file named by external ID. Handles compound IDs (semicolon-separated), sales org field remapping, filename sanitization, and manual CSV quoting.

**CLI Wrappers** — `src/lib/`

- `sfdmu.js` — Spawns `sf sfdmu run` as subprocess with timeout, real-time stdout streaming in verbose mode.
- `sf.js` — Salesforce CLI queries (`sf data query`) for sales org discovery and general SOQL.

### Key Patterns

**Sales org partitioning is optional.** If the YAML has a `salesOrg` section, data is split into subdirectories per org and processed sequentially. If absent, everything goes into a single flat directory. Many code paths branch on `config.hasSalesOrgs`.

**Temporary values.** Objects with `_temporaryValues` have fields overridden during CSV generation (e.g., `Is_Pushable__c = false` to prevent CG Cloud triggers). After the single SFDMU run completes, `restoreTemporaryValues()` queries the target org and updates each record to its real value via the API.

**Export pipeline.** Pre-processing enriches queries, then one or two SFDMU runs, then post-processing:

1. `_reference` — Query org for objects referencing this one, enrich WHERE with their values (OR'd with original)
2. SFDMU run 1 (all objects)
3. `_junction` — Read parent CSVs from run 1, build junction WHERE (AND'd across parents), run SFDMU again with only junctions (replaces unfiltered CSVs)
4. `_lookup` + `_hierarchy` — Scan CSVs for `#N/A` relationship values, query source org for real values, patch CSVs
5. CSV → JSON conversion

**Import pipeline.** Single SFDMU run with hierarchy resolution:

1. JSON → CSV conversion
2. SFDMU run (upserts all records, self-referencing lookups left NULL)
3. `resolveHierarchies()` — reads CSV for child→parent mapping, queries target org for IDs, updates self-referencing lookups via API

### JSON Config Schema

Consumer projects provide `config/<operation>.json` (e.g., `config/export.json`):

- `_dataDir` — JSON storage directory (default: `data`)
- `_salesOrg` — Optional `{ objectName, externalId }` enabling sales org partitioning
- `excludeIdsFromCSVFiles`, `promptOnIssuesInCSVFiles`, `promptOnMissingParentObjects` — SFDMU flags
- `objects[]` — Salesforce object definitions with standard SFDMU properties plus `_`-prefixed metadata:
    - `_reference` — `[{ objectName, fieldName }]`: pre-export WHERE enrichment from referencing objects
    - `_junction` — `[{ objectName, lookup }]`: post-first-run WHERE enrichment from parent CSVs
    - `_lookup` — `[{ objectName, fieldName }]`: post-export `#N/A` resolution by querying source org
    - `_hierarchy` — `[{ fieldName }]`: post-export `#N/A` resolution + post-import self-referencing lookup resolution
    - `_slim` — Include in slim imports
    - `_salesOrgObject` — Marks the sales org object itself

## Conventions

- CommonJS (`require`/`module.exports`) throughout
- Classes exported as `{ ClassName }` objects
- Console logging with emoji prefixes for status (✅ ❌ ⚠️ 🎉 💥 etc.)
- `config` object passed through constructors to all managers
- Commit messages use conventional commits (`fix:`, `refactor:`, `docs:`, etc.)
