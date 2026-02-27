/**
 * SFDMU Add-On: Union Resolver
 *
 * Runs as a script-level beforeAddons hook during onInit.
 * Replaces the wrapper's resolveUnions() pre-processing step.
 *
 * For objects that are referenced by multiple parents (e.g. KPI_Set referenced
 * by Account_Template, RTR_Report_Configuration, and Fund_Template), this add-on
 * queries the source org for each parent's referencing field values, collects all
 * IDs into a union set, and rewrites the object's WHERE clause with a flat IN list.
 *
 * This eliminates semi-join subselects that SOQL can't combine with OR, and ensures
 * all referenced records are included in the export.
 */
export default class UnionResolverAddon {
    constructor(runtime) {
        this.runtime = runtime;
    }

    async onInit(context, args) {
        const script = this.runtime.getScript();
        const unions = args.unions || {};

        for (const [objectName, unionConfig] of Object.entries(unions)) {
            const allIds = new Set();

            // Query each parent object for referencing field values
            for (const parent of unionConfig.parents) {
                const parentObj = script.objects.find((o) => o.objectName === parent.objectName);
                if (!parentObj) {
                    this._log(`Parent ${parent.objectName} not found in script objects, skipping`);
                    continue;
                }

                // Extract WHERE clause from parent's query (between WHERE and ORDER BY)
                const whereMatch = parentObj.query.match(/ WHERE (.+?)(?= ORDER BY )/i);
                let query = `SELECT ${parent.field} FROM ${parent.objectName}`;
                if (whereMatch) query += ` WHERE ${whereMatch[1]}`;

                this._log(`Querying ${parent.objectName} for ${parent.field}...`);

                const records = await this.runtime.queryMultiAsync(true, [query]);
                for (const record of records) {
                    const value = this._getNestedValue(record, parent.field);
                    if (value) allIds.add(value);
                }
            }

            // Also flatten the object's own WHERE clause to IDs
            // (SOQL forbids combining semi-join subselects with OR)
            const exportObj = script.objects.find((o) => o.objectName === objectName);
            if (exportObj) {
                const origWhere = exportObj.query.match(/ WHERE (.+?)(?= ORDER BY )/i);
                if (origWhere) {
                    const flatQuery = `SELECT ${unionConfig.externalId} FROM ${objectName} WHERE ${origWhere[1]}`;
                    this._log(`Resolving original ${objectName} WHERE to flat IDs...`);
                    const origRecords = await this.runtime.queryMultiAsync(true, [flatQuery]);
                    for (const r of origRecords) {
                        const v = r[unionConfig.externalId];
                        if (v) allIds.add(v);
                    }
                }
            }

            if (allIds.size === 0) {
                this._log(`No union IDs found for ${objectName}, skipping`);
                continue;
            }

            this._log(`Found ${allIds.size} combined IDs for ${objectName}`);

            // Build flat WHERE from externalId
            const idsStr = Array.from(allIds)
                .map((id) => `'${id.replace(/'/g, "\\'")}'`)
                .join(', ');
            const flatWhere = `${unionConfig.externalId} IN (${idsStr})`;

            if (exportObj) {
                const m = exportObj.query.match(/^(.+? WHERE )(.+)( ORDER BY .+)$/i);
                if (m) {
                    exportObj.query = `${m[1]}${flatWhere}${m[3]}`;
                } else {
                    const ob = exportObj.query.match(/^(.+?)( ORDER BY .+)$/i);
                    if (ob) {
                        exportObj.query = `${ob[1]} WHERE ${flatWhere}${ob[2]}`;
                    }
                }
                this._log(`Replaced ${objectName} WHERE with flat IDs`);
            }
        }

        return { cancel: false };
    }

    async onExecute(context, args) {
        return { cancel: false };
    }

    /**
     * Navigate a nested SOQL result object by dot-separated field path.
     * Handles both nested objects (standard SOQL) and flattened keys.
     */
    _getNestedValue(record, fieldPath) {
        // Try direct access first (flattened key)
        if (fieldPath in record) return record[fieldPath];
        // Traverse nested objects
        let current = record;
        for (const part of fieldPath.split('.')) {
            if (current == null) return null;
            current = current[part];
        }
        return current;
    }

    _log(message) {
        console.log(`  [UnionResolver] ${message}`);
    }
}
