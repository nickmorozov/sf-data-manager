# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

SF Data Manager is a Node.js CLI tool that wraps SFDMU (Salesforce Data Move Utility) to export/import Salesforce data. It reads object definitions from YAML config files in the consumer project, making it reusable across different Salesforce projects.

This repo is designed to be used as a **git submodule** in consumer projects.

## Architecture

### How it works
1. Consumer project has a `config/<name>.yaml` defining Salesforce objects to export/import
2. SF Data Manager reads the YAML at runtime via `src/configLoader.js`
3. Generates SFDMU `export.json` configs from the object definitions
4. Runs SFDMU to transfer data between orgs and CSV files
5. Converts CSV to/from JSON for version-controlled storage

### Key Files
- `main.js` - CLI entry point (Commander.js)
- `config/config.js` - Runtime configuration, loads YAML via configLoader
- `config/objectConfig.js` - Generates SFDMU query configs per object
- `config/exportJson.js` - Builds the SFDMU export.json structure
- `config/constants.js` - Shared constants (timeouts, slugs, log levels)
- `src/configLoader.js` - Reads YAML from consumer project's `config/` directory
- `src/dataManager.js` - Orchestrates export/import operations
- `src/csvManager.js` - CSV parsing, error analysis, sales org extraction
- `src/jsonConverter.js` - CSV ↔ JSON conversion for version control
- `lib/sfdmu.js` - SFDMU plugin wrapper (check, run, version)
- `lib/sf.js` - Salesforce CLI wrapper (queries, Apex execution)

### YAML Config Schema
Consumer projects provide a YAML config at `config/<name>.yaml`:
- `name` - Project name
- `dataDir` - JSON storage directory (default: `data`)
- `tmpDir` - CSV working directory (default: `tmp`)
- `salesOrg` - Optional: enables sales org partitioning when present
- `objects[]` - Array of Salesforce object definitions with externalId, fields, where, orderBy, etc.

### Placeholder Variables
- `${SALES_ORGS}` - Replaced with quoted sales org codes at runtime
- `${PARENT_IDS}` - Replaced with parent external IDs for junction queries

### Sales Org Behavior
- If `salesOrg` section exists in YAML: data is partitioned into subdirectories per sales org
- If absent: single flat data directory, no sales org filtering

## Development

### Dependencies
- `commander` - CLI framework
- `csv-parse` - CSV parsing (with BOM support)
- `csv-stringify` - CSV generation
- `dotenv` - Environment variable loading
- `fs-extra` - Enhanced filesystem operations
- `js-yaml` - YAML config parsing

### Running from consumer project
```bash
node sf-data-manager/main.js export -s <source-org> --source-orgs 0001,0002 --verbose
node sf-data-manager/main.js import -t <target-org> --source-orgs 0001
node sf-data-manager/main.js list -s <source-org>
```

### Prerequisites
- Node.js >= 20.x
- Salesforce CLI (`sf`)
- SFDMU plugin (`sf plugins install sfdmu`)
