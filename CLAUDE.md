# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

SF Data Manager is a Node.js CLI tool that wraps SFDMU (Salesforce Data Move Utility) to export/import Salesforce data. It reads object definitions from YAML config files in the consumer project, making it reusable across different Salesforce projects.

This repo is designed to be used as a **git submodule** in consumer projects. It is not standalone — it expects to be run from within a consumer project that has a `config/<name>.yaml` file.

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

- `config.js` — `Config` class. Loads YAML via `configLoader`, validates options, resolves paths, creates `ExportJson`. Getters expose filtered object lists: `allObjects`, `slimObjects`, `junctionObjects`, `hierarchyObjects`.
- `configLoader.js` — Finds and merges `.yaml`/`.yml` files in consumer's `config/` dir.
- `exportJson.js` — Builds the SFDMU `export.json` structure. Emits add-on manifests: script-level `beforeAddons` for union resolution (export), per-object `afterUpdateAddons` for hierarchy repair (import).
- `objectConfig.js` — Generates per-object SFDMU config: SOQL queries, WHERE/ORDER BY clauses, placeholder substitution (`${SALES_ORGS}`, `${PARENT_IDS}`).
- `constants.js` — Shared constants: `OPERATIONS`, `LOG_LEVELS`, `DEFAULT_TIMEOUT` (300s), placeholder slugs.

**Core** — `src/`

- `dataManager.js` — Orchestrator. Routes to single or multi-sales-org transfer. Handles junction exports, two-step temporary-value imports, and post-operation error analysis.
- `csvManager.js` — CSV parsing (with BOM support via `csv-parse`). Extracts sales orgs, parent IDs, hierarchy mappings. Analyzes SFDMU error reports (`CSVIssuesReport.csv`, `MissingParentRecordsReport.csv`).
- `jsonConverter.js` — Bidirectional CSV↔JSON. Each record becomes a separate JSON file named by external ID. Handles compound IDs (semicolon-separated), sales org field remapping, filename sanitization, and manual CSV quoting.

**CLI Wrappers** — `src/lib/`

- `sfdmu.js` — Spawns `sf sfdmu run` as subprocess with timeout, real-time stdout streaming in verbose mode.
- `sf.js` — Salesforce CLI queries (`sf data query`) for sales org discovery and general SOQL.

### Key Patterns

**Sales org partitioning is optional.** If the YAML has a `salesOrg` section, data is split into subdirectories per org and processed sequentially. If absent, everything goes into a single flat directory. Many code paths branch on `config.hasSalesOrgs`.

**Two-step import.** Objects with `temporaryValues` get imported twice: first with placeholder values (to satisfy required lookups), then again with real values. Tracked via `config.needTemporaryImport` / `config.madeTemporaryImport`.

**Junction record export.** Junction objects need a secondary SFDMU run with a dynamically-built WHERE clause (replacing `${PARENT_IDS}` with actual IDs extracted from the first export's CSV). Shared parent object CSVs are backed up and merged after.

**SFDMU add-ons** (`src/addons/`). Two native SFDMU add-ons handle processing that was previously done by the wrapper:
- `union-resolver.mjs` — Script-level `beforeAddons` hook (export). Queries source org for parent field values, collects IDs from all union parents, rewrites WHERE clauses with flat `IN (...)` lists. Eliminates semi-join subselects that SOQL can't combine with OR.
- `hierarchy-resolver.mjs` — Per-object `afterUpdateAddons` hook (import). Reads CSV for child→parent mapping, queries target org for record IDs, updates self-referencing lookup fields via DML. Replaces the previous Apex-based approach.

### YAML Config Schema

Consumer projects provide `config/<name>.yaml`:

- `name` — Project name
- `dataDir` — JSON storage directory (default: `data`)
- `tmpDir` — CSV working directory (default: `tmp`)
- `salesOrg` — Optional object config enabling sales org partitioning
- `objects[]` — Salesforce object definitions with: `objectName`, `externalId`, `fields`, `where`, `orderBy`, `operation` (default Upsert), `master`, `slim`, `junction`, `hierarchy`, `temporaryValues`, `excludedFields`

## Conventions

- CommonJS (`require`/`module.exports`) for all wrapper code; ESM (`.mjs`) for SFDMU add-ons (required by SFDMU's module loader)
- Classes exported as `{ ClassName }` objects
- Console logging with emoji prefixes for status (✅ ❌ ⚠️ 🎉 💥 etc.)
- `config` object passed through constructors to all managers
- Commit messages use conventional commits (`fix:`, `refactor:`, `docs:`, etc.)
