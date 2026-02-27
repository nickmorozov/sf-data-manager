const path = require('path');
const fs = require('fs-extra');
const { OPERATIONS, LOG_LEVELS, SALES_ORGS_SLUG } = require('./constants');

const CSV_FILE = 'csvfile';
const ADDON_BASE = path.resolve(__dirname, '../addons');

class Config {
    constructor(operation, options) {
        this.operation = operation;
        this.needTemporaryImport = false;
        this.madeTemporaryImport = false;

        if (!Object.values(OPERATIONS).includes(this.operation)) {
            throw new Error(`Invalid operation: ${this.operation}. Must be one of: ${Object.values(OPERATIONS).join(', ')}`);
        }

        // Load static JSON config from consumer project
        const projectRoot = process.cwd();
        const configPath = path.join(projectRoot, 'config', `${this.operation}.json`);

        if (!fs.existsSync(configPath)) {
            throw new Error(`Config file not found: ${configPath}`);
        }

        this._rawConfig = fs.readJsonSync(configPath);

        // Extract top-level metadata
        const salesOrgMeta = this._rawConfig._salesOrg;
        this._salesOrgConfig = salesOrgMeta || null;
        this.hasSalesOrgs = !!salesOrgMeta;

        // Parse CLI options
        const sourceOrgs =
            options.sourceOrgs
                ?.split(',')
                .map((org) => org.trim())
                .filter(Boolean) ?? [];
        const targetOrgs =
            options.targetOrgs
                ?.split(',')
                .map((org) => org.trim())
                .filter(Boolean) ?? sourceOrgs;

        if (targetOrgs.length > 0 && targetOrgs.length !== sourceOrgs.length && this.isImport) {
            throw new Error('The number of target sales orgs must match the number of source sales orgs.');
        }

        this.source = this.isImport ? CSV_FILE : options.source;
        if (!this.isImport && this.source === CSV_FILE) {
            throw new Error('Source org is required.');
        }

        this.target = this.isImport ? options.target : CSV_FILE;
        if (this.isImport && this.target === CSV_FILE) {
            throw new Error('Target org is required.');
        }

        this.salesOrgs = sourceOrgs.map((org, index) => ({
            source: org,
            target: targetOrgs[index] || org,
        }));

        this.slim = options.slim || false;
        if (!this.isImport && this.slim) {
            throw new Error('Slim option is only available for import operation.');
        }

        this.deleteOldData = options.delete || false;
        this.verbose = options.verbose || false;
        this.simulation = options.simulation || false;
        this.allOrNone = options.allOrNone || false;
        this.timeout = options.timeout * 1000;
        this.logLevel = options.verbose ? LOG_LEVELS.TRACE : options.logLevel;

        this.dataDir = path.resolve(projectRoot, this._rawConfig._dataDir || 'data');
        this.tmpDir = path.resolve(projectRoot, 'tmp');

        fs.ensureDir(this.dataDir).then();

        if (fs.pathExists(this.tmpDir)) {
            fs.remove(this.tmpDir);
        }
        fs.ensureDir(this.tmpDir);

        // Build the initial export.json
        this._exportJson = this._buildExportJson();
    }

    get exportJson() {
        return this._exportJson;
    }

    resetExportJson() {
        this._exportJson = this._buildExportJson();
    }

    get isExport() {
        return this.operation === OPERATIONS.EXPORT;
    }

    get isImport() {
        return this.operation === OPERATIONS.IMPORT;
    }

    /**
     * Get _-prefixed metadata for a raw config object by objectName.
     */
    getObjectMeta(objectName) {
        const obj = this._rawConfig.objects.find((o) => o.objectName === objectName);
        if (!obj) return null;

        const meta = {};
        for (const [key, value] of Object.entries(obj)) {
            if (key.startsWith('_')) {
                meta[key] = value;
            }
        }
        return meta;
    }

    /**
     * Get a raw config object by name (for mergeExportCsvs which needs externalId).
     */
    getObject(objectName) {
        return this._rawConfig.objects.find((o) => o.objectName === objectName) || null;
    }

    /**
     * Build the SFDMU export.json from raw config.
     * Deep-clones, filters, substitutes, builds addons, strips _ properties.
     */
    _buildExportJson() {
        const config = JSON.parse(JSON.stringify(this._rawConfig));

        // Filter objects
        let objects = config.objects;

        if (this.hasSalesOrgs && !this.targetOrg) {
            // First pass (no targetOrg yet) — only sales org object
            objects = objects.filter((o) => o._salesOrgObject);
        } else if (this.slim) {
            objects = objects.filter((o) => o._slim);
        }

        // Substitute ${SALES_ORGS} in queries
        for (const obj of objects) {
            obj.query = this._substituteQuery(obj.query, obj._salesOrgObject);
        }

        // Apply runtime flags
        const result = {
            excludeIdsFromCSVFiles: config.excludeIdsFromCSVFiles,
            promptOnIssuesInCSVFiles: config.promptOnIssuesInCSVFiles,
            promptOnMissingParentObjects: config.promptOnMissingParentObjects,
        };

        if (this.simulation) {
            result.simulationMode = true;
        }

        if (this.allOrNone) {
            result.promptOnIssuesInCSVFiles = true;
            result.promptOnMissingParentObjects = true;
            result.allOrNone = true;
        }

        // Apply deleteOldData override
        if (this.deleteOldData) {
            for (const obj of objects) {
                obj.deleteOldData = true;
            }
        }

        // Build addon manifests before stripping _ properties
        const addons = this._buildAddons(objects);
        if (addons.beforeAddons) {
            result.beforeAddons = addons.beforeAddons;
        }

        // Apply per-object afterUpdateAddons
        for (const obj of objects) {
            if (addons.objectAddons[obj.objectName]) {
                obj.afterUpdateAddons = addons.objectAddons[obj.objectName];
            }
        }

        // Strip all _-prefixed properties
        result.objects = objects.map((obj) => {
            const clean = {};
            for (const [key, value] of Object.entries(obj)) {
                if (!key.startsWith('_')) {
                    clean[key] = value;
                }
            }
            return clean;
        });

        return result;
    }

    /**
     * Substitute ${SALES_ORGS} placeholder in a query string.
     */
    _substituteQuery(query, isSalesOrgObject) {
        if (!query.includes(SALES_ORGS_SLUG)) return query;

        const salesOrgsString = this.salesOrgs
            ?.map((salesOrgs) => `'${this.isExport ? salesOrgs.source : salesOrgs.target}'`)
            .join(', ');

        // For sales org object with no sales orgs specified, remove WHERE clause
        if (isSalesOrgObject && !salesOrgsString) {
            return query.replace(/ WHERE .+?(?= ORDER BY )/i, '');
        }

        // Substitute with targetOrg (single org pass) or full list
        if (this.targetOrg) {
            return query.replaceAll(SALES_ORGS_SLUG, `'${this.targetOrg}'`);
        }

        if (salesOrgsString) {
            return query.replaceAll(SALES_ORGS_SLUG, salesOrgsString);
        }

        // No sales orgs and not a sales org object — remove WHERE clause
        return query.replace(/ WHERE .+?(?= ORDER BY )/i, '');
    }

    /**
     * Build SFDMU addon manifests from _ metadata.
     * _hierarchy entries become hierarchy-resolver addons on import.
     */
    _buildAddons(objects) {
        const result = { objectAddons: {} };

        // Hierarchy resolver (import only, non-simulation)
        // _hierarchy entries specify self-referencing lookup fields that need
        // post-import resolution by querying the target org
        if (this.isImport && !this.simulation) {
            for (const obj of objects) {
                if (!obj._hierarchy) continue;

                result.objectAddons[obj.objectName] = obj._hierarchy.map((r) => ({
                    path: path.join(ADDON_BASE, 'hierarchy-resolver.mjs'),
                    description: `Resolve self-lookup hierarchy for ${obj.objectName}`,
                    excluded: false,
                    args: {
                        childField: obj.externalId,
                        parentField: r.fieldName,
                        parentIdField: r.fieldName.replace(/__r\..+$/, '__c'),
                    },
                }));
            }
        }

        return result;
    }

    /**
     * Objects with _reference metadata (pre-export: enrich WHERE clauses).
     */
    get referenceObjects() {
        return this._rawConfig.objects.filter((o) => o._reference);
    }

    /**
     * Objects with _lookup metadata (post-export: resolve #N/A values).
     */
    get lookupObjects() {
        return this._rawConfig.objects.filter((o) => o._lookup);
    }

    /**
     * Objects with _junction metadata (post-first-export: filter by parent CSVs).
     */
    get junctionObjects() {
        return this._rawConfig.objects.filter((o) => o._junction);
    }

    /**
     * Objects with _hierarchy metadata (import: hierarchy-resolver addon; export: #N/A resolution).
     */
    get hierarchyObjects() {
        return this._rawConfig.objects.filter((o) => o._hierarchy);
    }

}

module.exports = {
    Config,
};
