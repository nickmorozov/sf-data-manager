/**
 * SFDMU Add-On: Hierarchy Resolver
 *
 * Runs as a per-object afterUpdateAddons hook during import.
 * Replaces the wrapper's updateSelfLookups() post-processing step.
 *
 * After SFDMU upserts records, self-referencing lookup fields are left NULL
 * (chicken-and-egg: parent records must exist before children can reference them).
 * This add-on reads the child→parent mapping from the CSV source file, queries the
 * target org for the inserted record IDs, and updates the self-referencing lookups.
 *
 * Args shape:
 *   { childField: "Name", parentField: "Relationship__r.Name", parentIdField: "Relationship__c" }
 */
import { readFileSync } from 'fs';
import { join } from 'path';

export default class HierarchyResolverAddon {
    constructor(runtime) {
        this.runtime = runtime;
    }

    async onInit(context, args) {
        return { cancel: false };
    }

    async onExecute(context, args) {
        const { childField, parentField, parentIdField } = args;
        if (!childField || !parentField || !parentIdField) return { cancel: false };

        const objectName = context.objectName;

        // Read the CSV source file to build child→parent mapping
        const childParentMap = this._readHierarchyFromCSV(objectName, childField, parentField);

        if (childParentMap.size === 0) {
            this._log(`No hierarchy mappings found for ${objectName}`);
            return { cancel: false };
        }

        this._log(`Found ${childParentMap.size} child→parent mappings for ${objectName}`);

        // Query target org for all records with their external IDs
        const allIds = new Set([...childParentMap.keys(), ...childParentMap.values()]);
        const idsStr = Array.from(allIds)
            .map((id) => `'${id.replace(/'/g, "\\'")}'`)
            .join(', ');
        const query = `SELECT Id, ${childField} FROM ${objectName} WHERE ${childField} IN (${idsStr})`;
        const targetRecords = await this.runtime.queryMultiAsync(false, [query]);

        // Build externalId → targetId mapping
        const extIdToTargetId = new Map();
        for (const record of targetRecords) {
            extIdToTargetId.set(record[childField], record.Id);
        }

        // Build update records
        const updates = [];
        for (const [childExtId, parentExtId] of childParentMap) {
            const childTargetId = extIdToTargetId.get(childExtId);
            const parentTargetId = extIdToTargetId.get(parentExtId);
            if (childTargetId && parentTargetId) {
                updates.push({ Id: childTargetId, [parentIdField]: parentTargetId });
            }
        }

        if (updates.length > 0) {
            this._log(`Updating ${updates.length} self-lookup hierarchies for ${objectName}`);
            await this.runtime.updateTargetRecordsAsync(objectName, 'Update', updates);
            this._log(`Successfully updated ${updates.length} records`);
        }

        return { cancel: false };
    }

    /**
     * Read the CSV source file and build a child→parent external ID mapping.
     * Only includes records where child and parent are different (actual hierarchy).
     */
    _readHierarchyFromCSV(objectName, childField, parentField) {
        const basePath = this.runtime.getScript().basePath;
        const csvPath = join(basePath, `${objectName}.csv`);

        let content;
        try {
            content = readFileSync(csvPath, 'utf8');
        } catch (err) {
            this._log(`Could not read CSV at ${csvPath}: ${err.message}`);
            return new Map();
        }

        const records = parseCSV(content);
        const childParentMap = new Map();

        for (const record of records) {
            const childId = (record[childField] || '').trim();
            const parentId = this._getNestedValue(record, parentField);
            if (childId && parentId && childId !== parentId) {
                childParentMap.set(childId, parentId);
            }
        }

        return childParentMap;
    }

    /**
     * Navigate a record by dot-separated field path.
     * CSV columns from SFDMU use the full relationship path as the header
     * (e.g. "cgcloud__Foo__r.Name"), so try direct access first.
     */
    _getNestedValue(record, fieldPath) {
        const direct = (record[fieldPath] || '').trim();
        if (direct) return direct;
        // Fallback: traverse nested objects (unlikely for CSV but safe)
        let current = record;
        for (const part of fieldPath.split('.')) {
            if (current == null) return null;
            current = current[part];
        }
        return typeof current === 'string' ? current.trim() : current;
    }

    _log(message) {
        console.log(`  [HierarchyResolver] ${message}`);
    }
}

// ── Self-contained CSV parser ────────────────────────────────────────────────
// Avoids dependency on csv-parse which may not be in SFDMU's module resolution path.

function parseCSV(content) {
    // Strip BOM
    const clean = content.replace(/^\uFEFF/, '');
    const lines = clean.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = values[i] || '';
        });
        return obj;
    });
}

function parseCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                current += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            fields.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields;
}
