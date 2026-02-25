# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

SF Data Manager is a Node.js CLI tool that wraps SFDMU (Salesforce Data Move Utility) to export/import Salesforce data. It reads object definitions from YAML config files in the consumer project, making it reusable across different Salesforce projects.

This repo is designed to be used as a **git submodule** in consumer projects. It is not standalone — it expects to be run from within a consumer project that has a `config/<name>.yaml` file.

## Running

From the consumer project root:
```bash
node sf-data-manager/main.js export -s <source-org> --source-orgs 0001,0002 --verbose
node sf-data-manager/main.js import -t <target-org> --source-orgs 0001
node sf-data-manager/main.js list -s <source-org>
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

### Layer Responsibilities

**CLI Layer** — `main.js`
Commander.js entry point. Parses args, creates `Config`, creates `DataManager`, runs `init()` then `processData()`.

**Config Layer** — `config/`
- `config.js` — `Config` class. Loads YAML via `configLoader`, validates options, resolves paths, creates `ExportJson`. Getters expose filtered object lists: `allObjects`, `slimObjects`, `junctionObjects`, `hierarchyObjects`.
- `configLoader.js` — Finds first `.yaml`/`.yml` in consumer's `config/` dir and parses it.
- `exportJson.js` — Builds the SFDMU `export.json` structure from object definitions.
- `objectConfig.js` — Generates per-object SFDMU config: SOQL queries, WHERE/ORDER BY clauses, placeholder substitution (`${SALES_ORGS}`, `${PARENT_IDS}`).
- `constants.js` — Shared constants: `OPERATIONS`, `LOG_LEVELS`, `DEFAULT_TIMEOUT` (300s), placeholder slugs.

**Core Logic** — `src/`
- `dataManager.js` — Orchestrator. Routes to single or multi-sales-org transfer. Handles junction exports, self-lookup Apex updates, two-step temporary-value imports, and post-operation error analysis.
- `csvManager.js` — CSV parsing (with BOM support via `csv-parse`). Extracts sales orgs, parent IDs, hierarchy mappings. Analyzes SFDMU error reports (`CSVIssuesReport.csv`, `MissingParentRecordsReport.csv`).
- `jsonConverter.js` — Bidirectional CSV↔JSON. Each record becomes a separate JSON file named by external ID. Handles compound IDs (semicolon-separated), sales org field remapping, filename sanitization, and manual CSV quoting.

**External Wrappers** — `lib/`
- `sfdmu.js` — Spawns `sf sfdmu run` as subprocess with timeout, real-time stdout streaming in verbose mode.
- `sf.js` — Salesforce CLI queries and Apex execution. Generates Apex from `templates/updateSelfLookups.apex` for self-referencing hierarchies.

### Key Patterns

**Sales org partitioning is optional.** If the YAML has a `salesOrg` section, data is split into subdirectories per org and processed sequentially. If absent, everything goes into a single flat directory. Many code paths branch on `config.hasSalesOrgs`.

**Two-step import.** Objects with `temporaryValues` get imported twice: first with placeholder values (to satisfy required lookups), then again with real values. Tracked via `config.needTemporaryImport` / `config.madeTemporaryImport`.

**Junction record export.** Junction objects need a secondary SFDMU run with a dynamically-built WHERE clause (replacing `${PARENT_IDS}` with actual IDs extracted from the first export's CSV). Shared parent object CSVs are backed up and merged after.

**Self-referencing hierarchies.** After import, objects with `hierarchy` config get an Apex script generated from `templates/updateSelfLookups.apex` and executed via `sf apex run` to rebuild parent-child relationships.

### YAML Config Schema

Consumer projects provide `config/<name>.yaml`:
- `name` — Project name
- `dataDir` — JSON storage directory (default: `data`)
- `tmpDir` — CSV working directory (default: `tmp`)
- `salesOrg` — Optional object config enabling sales org partitioning
- `objects[]` — Salesforce object definitions with: `objectName`, `externalId`, `fields`, `where`, `orderBy`, `operation` (default Upsert), `master`, `slim`, `junction`, `hierarchy`, `temporaryValues`, `excludedFields`

## Conventions

- CommonJS (`require`/`module.exports`) throughout, no ESM
- Classes exported as `{ ClassName }` objects
- Console logging with emoji prefixes for status (✅ ❌ ⚠️ 🎉 💥 etc.)
- `config` object passed through constructors to all managers
- Commit messages use conventional commits (`fix:`, `refactor:`, `docs:`, etc.)
