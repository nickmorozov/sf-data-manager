const fs = require('fs-extra');
const path = require('path');

const { CsvManager } = require('./csvManager');
const { JsonConverter } = require('./jsonConverter');
const { SfdmuManager } = require('./lib/sfdmu');
const { SfManager } = require('./lib/sf');

const { LINE_REPEAT, CSV_EXTENSION } = require('./config/constants');

const EXPORT_JSON = 'export.json';

class DataManager {
    constructor(config) {
        this.config = config;

        this.csvManager = new CsvManager(config);
        this.jsonConverter = new JsonConverter(config);

        this.sfdmuManager = new SfdmuManager(config);
        this.sfManager = new SfManager(config);
    }

    async init() {
        console.log('Initializing Data Manager...');

        try {
            await this.sfdmuManager.checkPlugin();
            console.log('✓ Data Manager initialized successfully');
        } catch (error) {
            console.error('✗ Failed to initialize Data Manager:', error.message);
            throw error;
        }

        console.log('\n🚀 Starting Data Processing...');

        console.log('='.repeat(LINE_REPEAT));
        console.log(`📋 Operation: ${this.capitalizeFirst(this.config.operation)}`);
        console.log(`📤 Source: ${this.config.source || 'CSV'}`);
        console.log(`📥 Target: ${this.config.target || 'CSV'}`);
        if (this.config.hasSalesOrgs) {
            console.log(`🏢 Source Sales Orgs: ${this.config.salesOrgs.map((org) => org.source).join(', ') || '(all)'}`);
            console.log(`🏢 Target Sales Orgs: ${this.config.salesOrgs.map((org) => org.target).join(', ') || '(all)'}`);
        }
        console.log(`🔍 Verbose: ${this.config.verbose ? 'Enabled' : 'Disabled'}`);
        console.log('='.repeat(LINE_REPEAT));

        if (this.config.hasSalesOrgs && this.config.salesOrgs.length === 0) {
            console.log('\n🔍 No sales orgs specified, fetching all available sales organizations...');
            await this.getAllSalesOrgs();
        }

        if (this.config.isImport) {
            await this.jsonConverter.jsonToCsv();
        }
    }

    async finish() {
        // Auto-convert all CSV to JSON after export operations
        if (this.config.isExport) {
            await this.jsonConverter.csvToJson(); // Convert all data (global + all sales orgs)
        }

        if (this.config.isImport) {
            await this.printOperationErrors();
        }
    }

    async processData() {
        const startTime = Date.now();

        try {
            if (this.config.hasSalesOrgs) {
                await this.transferSalesOrgData();
            } else {
                // No sales orgs — single flat transfer
                console.log('\n📊 Transferring data...');
                await this.transferData();
            }

            const totalTime = (Date.now() - startTime) / 1000;
            console.log('\n' + '='.repeat(LINE_REPEAT));
            console.log(`🎉 Data Processing completed successfully in ${totalTime}s!`);
            console.log('='.repeat(LINE_REPEAT));

            await this.finish();
        } catch (error) {
            const totalTime = (Date.now() - startTime) / 1000;
            console.log('\n' + '='.repeat(LINE_REPEAT));
            console.error(`💥 Data Processing failed after ${totalTime}s`);
            console.error(`❌ Error: ${error.message}`);
            console.log('='.repeat(LINE_REPEAT));
            throw error;
        }
    }

    /**
     * Print errors from the operation results
     */
    async printOperationErrors() {
        try {
            console.log('\n🔍 Analyzing operation errors...');

            if (!this.config.hasSalesOrgs) {
                // No sales org partitioning — analyze tmpDir directly
                await this.csvManager.printCSVErrors(this.config.tmpDir);
                return;
            }

            // Analyze each relevant sales org directory
            for (const salesOrg of this.config.salesOrgs) {
                const salesOrgDir = path.join(this.config.tmpDir, salesOrg.target);

                if (!(await fs.pathExists(salesOrgDir))) {
                    console.log(`⚠️  Sales org directory not found: ${salesOrgDir}`);
                    return;
                }

                console.log(`\n📊 Error analysis for Sales Org: ${salesOrg.target}`);
                await this.csvManager.printCSVErrors(salesOrgDir);
                console.log('='.repeat(LINE_REPEAT));
            }
        } catch (error) {
            console.error(`❌ Error analyzing sales org errors: ${error.message}`);
            throw error;
        }
    }

    async getAllSalesOrgs() {
        try {
            const queryOrg = this.config.isImport ? this.config.target : this.config.source;
            const allSalesOrgs = await this.sfManager.querySalesOrgs(queryOrg, this.config._salesOrgConfig);

            if (allSalesOrgs.length === 0) {
                console.warn('⚠️ No sales organizations found in source org');
                return;
            }

            console.log(`📋 Found ${allSalesOrgs.length} sales organizations: ${allSalesOrgs.join(', ')}`);

            this.config.salesOrgs = allSalesOrgs.map((org) => ({
                source: org,
                target: org, // Use the same org for target if not specified
            }));
        } catch (error) {
            console.error(`Error getting sales orgs: ${error.message}`);
            throw error;
        }
    }

    async transferSalesOrgData() {
        console.log('\n🔍 Getting sales organization data...');

        try {
            // Process each sales org sequentially to avoid overwhelming the API
            for (const salesOrgs of this.config.salesOrgs) {
                const sourceOrg = salesOrgs.source;
                const targetOrg = salesOrgs.target;
                this.config.targetOrg = this.config.isImport ? targetOrg : sourceOrg;
                this.config.resetExportJson(); // Reset configuration

                if (this.config.isImport) {
                    console.log(`\n📊 Importing data into Sales Org: ${targetOrg}${targetOrg === sourceOrg ? '' : ` from ${sourceOrg}`}`);
                } else {
                    console.log(`\n📤 Exporting data from Sales Org: ${sourceOrg}`);
                }

                try {
                    await this.transferData();
                    console.log(`✅ Sales Org ${this.config.targetOrg} processed successfully`);
                } catch (error) {
                    console.error(`❌ Failed to process Sales Org ${this.config.targetOrg}: ${error.message}`);
                    throw error;
                }
            }

            console.log(`\n🎉 All ${this.config.salesOrgs.length} sales organizations processed successfully!`);
        } catch (error) {
            console.error(`❌ Error in transferSalesOrgData: ${error.message}`);
            throw error;
        }
    }

    async transferData() {
        const startTime = Date.now();

        const targetDir = this.config.targetOrg ? path.join(this.config.tmpDir, this.config.targetOrg) : this.config.tmpDir;

        try {
            console.log(`\n📊 Preparing data transfer for ${this.config.operation}...`);

            await fs.ensureDir(targetDir);

            // Pre-export: enrich queries with before-lookups (queries the org)
            if (this.config.isExport && this.config.lookupObjects.length > 0) {
                await this.applyBeforeLookups();
            }

            if (this.config.verbose) {
                console.log('Export configuration:', JSON.stringify(this.config.exportJson, null, 2));
            }

            const exportPath = path.join(targetDir, EXPORT_JSON);

            // Write temporary config file
            await fs.writeJson(exportPath, this.config.exportJson, { spaces: 2 });
            console.log(`📄 Configuration written to: ${exportPath}`);

            // Handle two-step import if needed
            if (this.config.isImport && this.config.needTemporaryImport) {
                console.log(`First import with temporary values...`);
                await this.sfdmuManager.run(targetDir);
                await this.jsonConverter.jsonToCsv();
                console.log(`Second import with correct values...`);
            }

            await this.sfdmuManager.run(targetDir);

            const totalTime = (Date.now() - startTime) / 1000;
            console.log(`✅ ${this.capitalizeFirst(this.config.operation)} completed successfully in ${totalTime}s!`);

            // Post-export: resolve #N/A lookup values by querying the org directly
            if (this.config.isExport && this.config.lookupObjects.length > 0) {
                await this.resolveAfterLookups(targetDir);
            }
        } catch (error) {
            const totalTime = (Date.now() - startTime) / 1000;
            console.error(`❌ transferData failed after ${totalTime}s: ${error.message}`);
            throw error;
        }
    }

    /**
     * Pre-export: query the source org for each "before" lookup to enrich the first run's queries.
     *
     * For each lookup object with before: true entries, queries the source org to find
     * which records are referenced by other objects. Collects all values across lookups
     * and adds them to the object's WHERE clause. Sets master: true since we now have
     * a selective WHERE (rule: master: true when WHERE exists, false otherwise).
     *
     * Example: KPI_Set has 6 before-lookups from Promotion_Template, Account_Template, etc.
     * Each is queried with its own WHERE (respecting sales org filters). The union of all
     * results (e.g., 20 unique KPI_Set names) becomes KPI_Set's WHERE clause.
     */
    async applyBeforeLookups() {
        const lookupObjects = this.config.lookupObjects.filter((obj) => obj._lookup.some((l) => l.before));

        if (lookupObjects.length === 0) return;

        console.log(`\n🔗 Applying before-lookups...`);

        for (const obj of lookupObjects) {
            const allValues = new Set();
            const beforeLookups = obj._lookup.filter((l) => l.before);

            for (const lookup of beforeLookups) {
                // Find the referenced object's export config to get its WHERE clause
                const refObj = this.config.exportJson.objects.find((o) => o.objectName === lookup.objectName);

                // Build SOQL: SELECT <fieldName> FROM <objectName> WHERE <referenced object's WHERE>
                let whereClause = '';
                if (refObj) {
                    const whereMatch = refObj.query.match(/\bWHERE\s+(.+?)(?=\s+ORDER\s+BY\b|$)/i);
                    if (whereMatch) whereClause = ` WHERE ${whereMatch[1]}`;
                }

                const soql = `SELECT ${lookup.fieldName} FROM ${lookup.objectName}${whereClause}`;
                console.log(`  📊 Querying ${lookup.objectName} for ${lookup.fieldName}...`);

                try {
                    const records = await this.sfManager.query(this.config.source, soql);
                    const values = records.map((r) => this._extractNestedField(r, lookup.fieldName)).filter((v) => v && v !== '#N/A');

                    for (const v of values) allValues.add(v);
                    console.log(`  ✅ ${lookup.objectName}: ${new Set(values).size} unique values from ${records.length} records`);
                } catch (error) {
                    console.warn(`  ⚠️  Query failed for ${lookup.objectName}: ${error.message}`);
                }
            }

            if (allValues.size === 0) {
                console.log(`  ⏭️  ${obj.objectName}: no before-lookup values found`);
                continue;
            }

            // Modify the export.json object entry
            const exportObj = this.config.exportJson.objects.find((o) => o.objectName === obj.objectName);
            if (!exportObj) continue;

            // Build WHERE: externalId IN (all collected values)
            const idsString = [...allValues].map((v) => `'${v.replace(/'/g, "\\'")}'`).join(', ');
            const newCondition = `${obj.externalId} IN (${idsString})`;

            // Parse original query, preserve WHERE and ORDER BY
            const selectFrom = exportObj.query.split(/\s+WHERE\s+|\s+ORDER\s+BY\s+/i)[0];
            const originalWhereMatch = exportObj.query.match(/\bWHERE\s+(.+?)(?=\s+ORDER\s+BY\b|$)/i);
            const orderByMatch = exportObj.query.match(/\bORDER\s+BY\s+(.+)$/i);
            const orderBy = orderByMatch ? ` ORDER BY ${orderByMatch[1]}` : '';

            const where = originalWhereMatch ? `(${originalWhereMatch[1]}) OR ${newCondition}` : newCondition;

            exportObj.query = `${selectFrom} WHERE ${where}${orderBy}`;
            exportObj.master = true; // WHERE present → master: true for relationship resolution

            console.log(`  🔗 ${obj.objectName}: enriched with ${allValues.size} lookup values, master: true`);
        }
    }

    /**
     * Post-export: resolve #N/A lookup values by querying the org directly.
     *
     * Instead of running a supplementary SFDMU pass (which can hit URI Too Long errors
     * with large record sets), this method:
     * 1. Scans each lookup object's CSV for #N/A relationship field values
     * 2. Queries the source org for the correct values
     * 3. Patches the CSV with the real relationship values
     *
     * This gives SFDMU and the hierarchy-resolver addon the real values they need
     * during import (e.g., Parent__r.Name = 'ActualRecord' instead of '#N/A').
     */
    async resolveAfterLookups(targetDir) {
        const lookupObjects = this.config.lookupObjects.filter((obj) => obj._lookup.some((l) => !l.before));

        if (lookupObjects.length === 0) return;

        console.log(`\n🔗 Resolving lookup values...`);

        for (const obj of lookupObjects) {
            const afterLookups = obj._lookup.filter((l) => !l.before);
            const fieldNames = afterLookups.map((l) => l.fieldName);

            // Read this object's CSV
            const csvPath = path.join(targetDir, obj.objectName + CSV_EXTENSION);
            const records = await this.csvManager.readCsvRecords(csvPath);

            if (records.length === 0) continue;

            // Find records where any lookup fieldName is #N/A
            const recordsWithNA = records.filter((r) => fieldNames.some((f) => r[f] === '#N/A'));

            if (recordsWithNA.length === 0) {
                console.log(`  ✅ ${obj.objectName}: no #N/A lookup values`);
                continue;
            }

            // Collect externalIds of records with #N/A
            const getKey = this._buildKeyFn(obj.externalId);
            const idsWithNA = [...new Set(recordsWithNA.map(getKey).filter(Boolean))];

            console.log(`  📊 ${obj.objectName}: ${idsWithNA.length} records with #N/A in ${fieldNames.length} lookup fields`);

            // Query org for the correct lookup values
            // SELECT <externalId>, <field1>, <field2>, ... FROM <object> WHERE <externalId> IN (...)
            const selectFields = [obj.externalId, ...fieldNames];
            const escape = (v) => v.replace(/'/g, "\\'");

            // Batch the query if too many IDs (SOQL has ~20K char limit)
            const BATCH_SIZE = 200;
            const valueMap = new Map();

            for (let i = 0; i < idsWithNA.length; i += BATCH_SIZE) {
                const batch = idsWithNA.slice(i, i + BATCH_SIZE);
                const idsString = batch.map((v) => `'${escape(v)}'`).join(', ');
                const soql = `SELECT ${selectFields.join(', ')} FROM ${obj.objectName} WHERE ${obj.externalId} IN (${idsString})`;

                try {
                    const orgRecords = await this.sfManager.query(this.config.source, soql);

                    for (const orgRecord of orgRecords) {
                        const key = orgRecord[obj.externalId] || this._extractNestedField(orgRecord, obj.externalId);
                        if (!key) continue;

                        const values = {};
                        for (const fieldName of fieldNames) {
                            const val = this._extractNestedField(orgRecord, fieldName);
                            if (val) values[fieldName] = val;
                        }
                        valueMap.set(key, values);
                    }
                } catch (error) {
                    console.warn(`  ⚠️  Query failed for ${obj.objectName} (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${error.message}`);
                }
            }

            // Update CSV records with queried values
            let updated = 0;
            for (const record of records) {
                const key = getKey(record);
                const newValues = key ? valueMap.get(key) : null;
                if (!newValues) continue;

                for (const [field, value] of Object.entries(newValues)) {
                    if (record[field] === '#N/A') {
                        record[field] = value;
                        updated++;
                    }
                }
            }

            if (updated > 0) {
                await this._writeCsvRecords(csvPath, records);
                console.log(`  ✅ ${obj.objectName}: resolved ${updated} lookup values`);
            } else {
                console.log(`  ✅ ${obj.objectName}: all lookups genuinely null in org`);
            }
        }

        console.log(`✅ Lookup resolution completed`);
    }

    /**
     * Build a key extraction function for CSV records.
     * Handles compound externalIds (semicolon-separated field names → concatenated values).
     */
    _buildKeyFn(externalId) {
        if (externalId.includes(';')) {
            const parts = externalId.split(';');
            return (record) => {
                const values = parts.map((p) => record[p]);
                return values.every(Boolean) ? values.join(';') : null;
            };
        }
        return (record) => record[externalId] || null;
    }

    /**
     * Write records to a CSV file.
     */
    async _writeCsvRecords(filePath, records) {
        if (records.length === 0) return;

        const headers = Object.keys(records[0]);
        const lines = [headers.join(',')];

        for (const record of records) {
            const values = headers.map((h) => this._csvEscape(record[h] ?? ''));
            lines.push(values.join(','));
        }

        await fs.writeFile(filePath, lines.join('\n'));
    }

    /**
     * Escape a value for CSV output.
     */
    _csvEscape(value) {
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    /**
     * Extract a value from a nested SOQL result using dot-separated field path.
     * SOQL relationship queries return nested objects, e.g.:
     *   SELECT cgcloud__KPI_Set__r.Name → { cgcloud__KPI_Set__r: { Name: 'value' } }
     */
    _extractNestedField(record, fieldPath) {
        const parts = fieldPath.split('.');
        let val = record;
        for (const part of parts) {
            val = val?.[part];
        }
        return val || null;
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

module.exports = {
    DataManager,
};
