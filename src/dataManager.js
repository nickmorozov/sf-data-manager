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

            if (this.config.verbose) {
                console.log('Export configuration:', JSON.stringify(this.config.exportJson, null, 2));
            }

            await fs.ensureDir(targetDir);

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

            // Post-export: supplementary passes to fill in missing lookup records
            if (this.config.isExport && this.config.lookupObjects.length > 0) {
                await this.exportExtraLookups(targetDir);
            }
        } catch (error) {
            const totalTime = (Date.now() - startTime) / 1000;
            console.error(`❌ transferData failed after ${totalTime}s: ${error.message}`);
            throw error;
        }
    }

    /**
     * Post-export: resolve all _lookup entries by reading referenced CSVs,
     * identifying missing or filtered records, and running supplementary SFDMU exports.
     *
     * Handles three lookup patterns via a single unified mechanism:
     *   - No filterBy: read objectName's CSV, extract fieldName values,
     *     find THIS object's missing records by externalId (union/hierarchy)
     *   - With filterBy: read objectName's CSV, extract fieldName values,
     *     find THIS object's records WHERE filterBy IN (values) (junction)
     *   - Self-referencing (objectName === this object, no filterBy):
     *     iterates to resolve multi-level hierarchies (up to MAX_DEPTH)
     */
    async exportExtraLookups(targetDir) {
        console.log(`\n🔗 Resolving lookups...`);

        const MAX_DEPTH = 5;
        let hasSelfRef = false;

        for (let iteration = 1; iteration <= MAX_DEPTH; iteration++) {
            const objects = [];
            const backupNames = new Set();

            for (const obj of this.config.lookupObjects) {
                const allReferencedIds = new Set();
                const filterClauses = [];

                for (const lookup of obj._lookup) {
                    const isSelfRef = lookup.objectName === obj.objectName && !lookup.filterBy;

                    // After first iteration, only process self-referencing lookups (hierarchy)
                    if (iteration > 1 && !isSelfRef) continue;
                    if (isSelfRef) hasSelfRef = true;

                    // Read the lookup object's CSV and extract field values
                    const csvPath = path.join(targetDir, lookup.objectName + CSV_EXTENSION);
                    const records = await this.csvManager.readCsvRecords(csvPath);
                    const values = [...new Set(records.map((r) => r[lookup.fieldName]).filter((v) => v && v !== '#N/A'))];

                    if (values.length === 0) continue;

                    if (lookup.filterBy) {
                        // Junction: filter THIS object by the lookup field
                        const idsString = values.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(', ');
                        filterClauses.push(`${lookup.filterBy} IN (${idsString})`);
                        console.log(`  📊 ${obj.objectName}: ${values.length} ${lookup.objectName} IDs for ${lookup.filterBy}`);
                    } else {
                        // Union/hierarchy: collect referenced IDs to check against already-exported
                        for (const v of values) allReferencedIds.add(v);
                    }
                }

                // For union/hierarchy: find which referenced IDs are missing from this object's CSV
                if (allReferencedIds.size > 0) {
                    const existingCsvPath = path.join(targetDir, obj.objectName + CSV_EXTENSION);
                    const existingRecords = await this.csvManager.readCsvRecords(existingCsvPath);
                    const exportedIds = new Set(existingRecords.map((r) => r[obj.externalId]).filter(Boolean));
                    const missingIds = [...allReferencedIds].filter((v) => !exportedIds.has(v));

                    if (missingIds.length > 0) {
                        const idsString = missingIds.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(', ');
                        filterClauses.push(`${obj.externalId} IN (${idsString})`);
                        console.log(`  📊 ${obj.objectName}: ${missingIds.length} missing records${iteration > 1 ? ` (depth ${iteration})` : ''}`);
                    } else if (iteration === 1 && filterClauses.length === 0) {
                        console.log(`  ✅ ${obj.objectName}: all ${allReferencedIds.size} referenced records already exported`);
                    }
                }

                if (filterClauses.length === 0) continue;

                // Build export object with combined WHERE clause
                const exportObj = this.config.exportJson.objects.find((o) => o.objectName === obj.objectName);
                if (!exportObj) continue;

                const where = filterClauses.length === 1 ? filterClauses[0] : `(${filterClauses.join(' OR ')})`;
                const [selectFrom] = exportObj.query.split(/ WHERE | ORDER BY /i);
                const orderByMatch = exportObj.query.match(/ ORDER BY (.+)$/i);
                const orderBy = orderByMatch ? ` ORDER BY ${orderByMatch[1]}` : '';

                objects.push({
                    ...exportObj,
                    query: `${selectFrom} WHERE ${where}${orderBy}`,
                    master: true,
                });

                backupNames.add(obj.objectName);
            }

            if (objects.length === 0) {
                if (iteration === 1) console.log(`  ✅ No missing lookup records`);
                break;
            }

            // Back up existing CSVs before supplementary export overwrites them
            const backups = {};
            for (const objectName of backupNames) {
                const csvPath = path.join(targetDir, objectName + CSV_EXTENSION);
                backups[objectName] = await this.csvManager.readCsvRecords(csvPath);
            }

            try {
                const lookupExportJson = { ...this.config.exportJson, objects };

                if (this.config.verbose) {
                    console.log(`  Export configuration:`, JSON.stringify(lookupExportJson, null, 2));
                }

                const exportPath = path.join(targetDir, EXPORT_JSON);
                await fs.writeJson(exportPath, lookupExportJson, { spaces: 2 });
                await this.sfdmuManager.run(targetDir);
                await this.mergeExportCsvs(targetDir, backups);
            } catch (error) {
                console.error(`  ❌ Failed to export lookup records: ${error.message}`);
                throw error;
            }

            // Only iterate if there are self-referencing lookups (hierarchy)
            if (!hasSelfRef) break;
        }

        console.log(`✅ Lookup export completed`);
    }

    /**
     * Merge backed-up CSV records with supplementary export results.
     * Backed-up records take priority for duplicate external IDs (they have complete lookup context).
     */
    async mergeExportCsvs(targetDir, backups) {
        for (const [objectName, backedUpRecords] of Object.entries(backups)) {
            if (backedUpRecords.length === 0) continue;

            const objectConfig = this.config.getObject(objectName);
            if (!objectConfig) continue;

            const csvPath = path.join(targetDir, objectName + CSV_EXTENSION);
            const newRecords = await this.csvManager.readCsvRecords(csvPath);

            const externalId = objectConfig.externalId;
            const merged = new Map();

            // New records first, then backed-up records overwrite duplicates
            for (const record of newRecords) {
                const key = record[externalId];
                if (key) merged.set(key, record);
            }
            for (const record of backedUpRecords) {
                const key = record[externalId];
                if (key) merged.set(key, record);
            }

            const mergedRecords = Array.from(merged.values());

            if (mergedRecords.length !== newRecords.length) {
                console.log(`  🔀 Merged ${objectName}: ${backedUpRecords.length} (existing) + ${newRecords.length} (new) → ${mergedRecords.length} unique records`);
            }

            await this.jsonConverter.writeRecordsToCsv(mergedRecords, csvPath);
        }
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

module.exports = {
    DataManager,
};
