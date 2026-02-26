const fs = require('fs-extra');
const path = require('path');

const { CsvManager } = require('./csvManager');
const { JsonConverter } = require('./jsonConverter');
const { SfdmuManager } = require('./../lib/sfdmu');
const { SfManager } = require('./../lib/sf');

const { LINE_REPEAT, PARENT_IDS_SLUG, CSV_EXTENSION } = require('./../config/constants');

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

        if (this.config.hasSalesOrgs && (this.config.salesOrgs.length === 0 || this.config.isList)) {
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
            if (this.config.isList) {
                if (!this.config.hasSalesOrgs) {
                    console.log('This project does not use sales organizations.');
                    return;
                }
                await this.listSalesOrgs();
                return;
            }

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
            const allSalesOrgs = await this.sfManager.querySalesOrgs(queryOrg, this.config._salesOrgObject);

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

    async listSalesOrgs() {
        try {
            console.log('Available Sales Organizations:');
            this.config.salesOrgs.forEach((pair) => {
                console.log(`- ${pair.source}`);
            });
        } catch (error) {
            console.error(`Error listing sales orgs: ${error.message}`);
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
            await fs.writeJson(exportPath, this.config.exportJson, { spaces: 4 });
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

            // Post-export phases: unions → junctions
            if (this.config.isExport) {
                await this.exportUnions(targetDir);
                if (this.config.junctionObjects.length > 0) {
                    await this.exportExtraJunctions(targetDir);
                }
            }

            // Update self-referencing lookups if needed
            if (this.config.isImport && this.config.hierarchyObjects.length > 0 && !this.config.simulation) {
                await this.updateSelfLookups(targetDir);
            }
        } catch (error) {
            const totalTime = (Date.now() - startTime) / 1000;
            console.error(`❌ transferData failed after ${totalTime}s: ${error.message}`);
            throw error;
        }
    }

    /**
     * Export additional records for objects with union configs.
     * Reads lookup values from other objects' CSVs, builds flat WHERE clauses,
     * runs a targeted SFDMU pass, and merges results into existing CSVs.
     */
    async exportUnions(targetDir) {
        if (this.config.unionObjects.length === 0) return;

        console.log(`\n🔗 Processing union exports...`);

        const objects = [];
        const objectBackupNames = new Set();

        for (const objectConfig of this.config.unionObjects) {
            const unions = Array.isArray(objectConfig.union) ? objectConfig.union : [objectConfig.union];

            // Collect all parent IDs from all union sources for this object
            const allParentIds = new Set();

            for (const unionConfig of unions) {
                const parentIds = await this.csvManager.getParentExternalIdsFromSalesOrg(targetDir, unionConfig.parent);
                parentIds.forEach((id) => allParentIds.add(id));
            }

            if (allParentIds.size === 0) {
                console.log(`  ⚠️ No union parent IDs found for ${objectConfig.objectName}, skipping`);
                continue;
            }

            console.log(`  📊 Found ${allParentIds.size} union IDs for ${objectConfig.objectName}: ${Array.from(allParentIds).join(', ')}`);

            // Build WHERE clause with literal values — no semi-joins
            const idsString = Array.from(allParentIds)
                .map((id) => `'${id.replace(/'/g, "\\'")}'`)
                .join(', ');
            // Use the first union's WHERE template (replace ${PARENT_IDS})
            const whereTemplate = unions[0].where;
            const where = whereTemplate.replace(PARENT_IDS_SLUG, idsString);

            // Find this object's export config and rebuild query with union WHERE
            const exportObject = this.config.exportJson.objects.find((obj) => obj.objectName === objectConfig.objectName);
            if (!exportObject) {
                console.warn(`  ⚠️ Could not find export config for ${objectConfig.objectName}, skipping`);
                continue;
            }

            const [selectFrom] = exportObject.query.split(/ WHERE /i);
            const orderBy = exportObject.query.split(/ ORDER BY /i).pop();

            objects.push({
                ...exportObject,
                query: `${selectFrom} WHERE ${where} ORDER BY ${orderBy}`,
                master: true,
            });

            objectBackupNames.add(objectConfig.objectName);
        }

        if (objects.length === 0) {
            console.log(`  ⚠️ No union objects to export, skipping`);
            return;
        }

        // Back up existing CSVs before union export overwrites them
        const backups = {};
        for (const objectName of objectBackupNames) {
            const csvPath = path.join(targetDir, objectName + CSV_EXTENSION);
            backups[objectName] = await this.csvManager.readCsvRecords(csvPath);
            if (this.config.verbose && backups[objectName].length > 0) {
                console.log(`  📦 Backed up ${backups[objectName].length} ${objectName} records`);
            }
        }

        // Run targeted SFDMU pass for union objects
        try {
            const unionExportJson = { ...this.config.exportJson, objects };

            if (this.config.verbose) {
                console.log(`  Union export configuration:`, JSON.stringify(unionExportJson, null, 2));
            }

            const exportPath = path.join(targetDir, EXPORT_JSON);
            await fs.writeJson(exportPath, unionExportJson, { spaces: 4 });
            await this.sfdmuManager.run(targetDir);

            // Merge: existing/main records take priority
            await this.mergeExportCsvs(targetDir, backups);

            console.log(`✅ Union export completed successfully!`);
        } catch (error) {
            console.error(`  ❌ Failed to export union records: ${error.message}`);
            throw error;
        }
    }

    /**
     * Export KPI Set definitions for a specific sales org
     * @returns {Promise<void>}
     */
    async exportExtraJunctions(targetDir) {
        console.log(`\n🎯 Exporting extra junction records...`);

        const objects = [];
        const sharedObjectNames = new Set();

        for (const junctionConfig of this.config.junctionObjects) {
            const junctions = Array.isArray(junctionConfig.junction) ? junctionConfig.junction : [junctionConfig.junction];

            try {
                // Collect parent IDs from all junction sources (OR-combined)
                const allExternalIds = new Set();
                for (const junction of junctions) {
                    const ids = await this.csvManager.getParentExternalIdsFromSalesOrg(targetDir, junction.parent);
                    ids.forEach((id) => allExternalIds.add(id));
                }
                const externalIds = Array.from(allExternalIds);

                if (externalIds.length === 0) {
                    console.log(`  ⚠️ No parent records found for ${junctionConfig.objectName}, skipping junction export`);
                    continue;
                }

                console.log(`  📊 Found ${externalIds.length} parent records for ${junctionConfig.objectName}: ${externalIds.join(', ')}`);

                // Create a WHERE clause for the parent IDs
                const where = junctions[0].where.replace(PARENT_IDS_SLUG, externalIds.map((id) => `'${id.replace(/'/g, "\\'")}'`).join(', '));

                // Create custom export configuration for junction records
                let junctionObject = this.config.exportJson.objects.find((objectConfig) => objectConfig.objectName === junctionConfig.objectName);
                // Build junction query: replace any existing WHERE with the junction WHERE
                const [selectFrom] = junctionObject.query.split(/ WHERE /i);
                const orderBy = junctionObject.query.split(/ ORDER BY /i).pop();
                objects.push({
                    ...junctionObject,
                    query: `${selectFrom} WHERE ${where} ORDER BY ${orderBy}`,
                    master: true,
                });

                // Collect shared objects from ALL junction configs
                const sharedObjects = new Set();
                for (const junction of junctions) {
                    if (junction.objects) {
                        junction.objects.forEach((name) => sharedObjects.add(name));
                    }
                }

                for (const parentName of sharedObjects) {
                    const parentObjectConfig = this.config.exportJson.objects.find((objectConfig) => objectConfig.objectName === parentName);

                    if (!parentObjectConfig) {
                        console.warn(`⚠️ Could not find configuration for ${parentName}, skipping`);
                        continue;
                    }

                    if (!objects.some((objectConfig) => objectConfig.objectName === parentName)) {
                        objects.push(parentObjectConfig);
                    }

                    // Track shared objects so we can merge CSVs after junction export
                    sharedObjectNames.add(parentName);
                }
            } catch (error) {
                console.error(`❌ Failed to export ${junctionConfig.objectName}: ${error.message}`);
                throw error;
            }
        }

        if (objects.length === 0) {
            console.log(`  ⚠️ No junction objects to export, skipping`);
            return;
        }

        // Back up CSV records for shared objects before junction export overwrites them
        const backups = {};
        for (const objectName of sharedObjectNames) {
            const csvPath = path.join(targetDir, objectName + CSV_EXTENSION);
            backups[objectName] = await this.csvManager.readCsvRecords(csvPath);
            if (this.config.verbose && backups[objectName].length > 0) {
                console.log(`  📦 Backed up ${backups[objectName].length} ${objectName} records`);
            }
        }

        // Create the export configuration for junction records
        try {
            const junctionExportJson = { ...this.config.exportJson, objects };

            if (this.config.verbose) {
                console.log(`  Export configuration for junction records :`, JSON.stringify(junctionExportJson, null, 2));
            }

            // Write the export configuration
            const exportPath = path.join(targetDir, EXPORT_JSON);
            await fs.writeJson(exportPath, junctionExportJson, { spaces: 4 });

            // Run SFDMU export for KPI Set definitions
            await this.sfdmuManager.run(targetDir);

            // Merge backed-up records with junction export results
            await this.mergeExportCsvs(targetDir, backups);

            console.log(`✅ Junction export completed successfully!`);
        } catch (error) {
            console.error(`  ❌ Failed to export junction records: ${error.message}`);
            throw error;
        }
    }

    /**
     * Merge backed-up CSV records from the main export with junction export results.
     * Main records take priority for duplicate external IDs (they have complete lookup context).
     */
    async mergeExportCsvs(targetDir, backups) {
        for (const [objectName, mainRecords] of Object.entries(backups)) {
            if (mainRecords.length === 0) continue;

            const objectConfig = this.config.getObject(objectName);
            if (!objectConfig) continue;

            const csvPath = path.join(targetDir, objectName + CSV_EXTENSION);
            const junctionRecords = await this.csvManager.readCsvRecords(csvPath);

            // Merge by external ID (main records take priority — they have complete lookup context)
            const externalId = objectConfig.externalId;
            const merged = new Map();

            for (const record of junctionRecords) {
                const key = record[externalId];
                if (key) merged.set(key, record);
            }
            for (const record of mainRecords) {
                const key = record[externalId];
                if (key) merged.set(key, record);
            }

            const mergedRecords = Array.from(merged.values());

            if (mergedRecords.length !== junctionRecords.length) {
                console.log(`  🔀 Merged ${objectName}: ${mainRecords.length} (main) + ${junctionRecords.length} (junction) → ${mergedRecords.length} unique records`);
            }

            await this.jsonConverter.writeRecordsToCsv(mergedRecords, csvPath);
        }
    }

    async updateSelfLookups(targetDir) {
        console.log(`\n🚀 Running Apex script to set parent names for self-referencing objects...`);

        for (const objectConfig of this.config.hierarchyObjects) {
            const hierarchies = Array.isArray(objectConfig.hierarchy) ? objectConfig.hierarchy : [objectConfig.hierarchy];

            for (const hierarchy of hierarchies) {
                // Build a temporary config view with the specific hierarchy for this iteration
                const hierarchyConfig = { ...objectConfig, hierarchy };

                const childParentMapping = await this.csvManager.getChildParentMapping(targetDir, hierarchyConfig);
                const apexPath = await this.sfManager.generateSelfLookupsScript(targetDir, hierarchyConfig, childParentMapping);
                await this.sfManager.runApex(apexPath);
            }
        }
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

module.exports = {
    DataManager,
};
