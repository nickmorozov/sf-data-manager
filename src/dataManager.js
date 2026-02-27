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

            // Pre-export: enrich queries with reference lookups (queries the org)
            if (this.config.isExport && this.config.referenceObjects.length > 0) {
                await this.applyBeforeReferences();
            }

            const exportPath = path.join(targetDir, EXPORT_JSON);

            // Write temporary config file
            this._verboseLog('Export configuration', this.config.exportJson);
            await fs.writeJson(exportPath, this.config.exportJson, { spaces: 2 });
            console.log(`📄 Configuration written to: ${exportPath}`);

            await this.sfdmuManager.run(targetDir);

            // Post-import: resolve hierarchies and restore temporary values
            if (this.config.isImport && !this.config.simulation) {
                if (this.config.hierarchyObjects.length > 0) {
                    await this.resolveHierarchies();
                }
                if (this.config.needTemporaryImport) {
                    await this.restoreTemporaryValues();
                }
            }

            // Post-first-export: filter and export junction objects in a second SFDMU run
            if (this.config.isExport && this.config.junctionObjects.length > 0) {
                await this.exportJunctions(targetDir);
            }

            const totalTime = (Date.now() - startTime) / 1000;
            console.log(`✅ ${this.capitalizeFirst(this.config.operation)} completed successfully in ${totalTime}s!`);

            // Post-export: resolve #N/A lookup values by querying the org directly
            if (this.config.isExport) {
                await this.resolveAfterLookups(targetDir);
            }
        } catch (error) {
            const totalTime = (Date.now() - startTime) / 1000;
            console.error(`❌ transferData failed after ${totalTime}s: ${error.message}`);
            throw error;
        }
    }

    /**
     * Pre-export: query the source org for each _reference entry to enrich queries.
     *
     * For each object with _reference entries, queries the source org to find
     * which records are referenced by other objects. Collects all values across references
     * and adds them to the object's WHERE clause. Sets master: true since we now have
     * a selective WHERE (rule: master: true when WHERE exists, false otherwise).
     *
     * Example: KPI_Set has 6 references from Promotion_Template, Account_Template, etc.
     * Each is queried with its own WHERE (respecting sales org filters). The union of all
     * results (e.g., 20 unique KPI_Set names) becomes KPI_Set's WHERE clause.
     */
    async applyBeforeReferences() {
        const refObjects = this.config.referenceObjects;

        if (refObjects.length === 0) {
            return;
        }

        console.log(`\n🔗 Applying references...`);

        for (const obj of refObjects) {
            const allValues = new Set();

            for (const lookup of obj._reference) {
                // Find the referenced object's export config to get its WHERE clause
                const refObj = this.config.exportJson.objects.find((o) => o.objectName === lookup.objectName);

                // Build SOQL: SELECT <fieldName> FROM <objectName> WHERE <referenced object's WHERE>
                let whereClause = '';
                if (refObj) {
                    const whereMatch = refObj.query.match(/\bWHERE\s+(.+?)(?=\s+ORDER\s+BY\b|$)/i);
                    if (whereMatch) {
                        whereClause = ` WHERE ${whereMatch[1]}`;
                    }
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
                console.log(`  ⏭️  ${obj.objectName}: no reference values found`);
                continue;
            }

            // Modify the export.json object entry
            const exportObj = this.config.exportJson.objects.find((o) => o.objectName === obj.objectName);
            if (!exportObj) {
                continue;
            }

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

            console.log(`  🔗 ${obj.objectName}: enriched with ${allValues.size} reference values, master: true`);
        }
    }

    /**
     * Post-import: restore temporary field values to their real values.
     *
     * During CSV generation, _temporaryValues overrides fields (e.g., Is_Pushable__c = false)
     * to prevent CG Cloud from triggering downstream processes during upsert.
     * After SFDMU completes, this queries for the affected records and sets the real values.
     */
    async restoreTemporaryValues() {
        console.log(`\n🔄 Restoring temporary values...`);

        for (const obj of this.config.exportJson.objects) {
            const meta = this.config.getObjectMeta(obj.objectName);
            const temporaryValues = meta?._temporaryValues;
            if (!temporaryValues) {
                continue;
            }

            // Query target org for records that need updating
            const fields = Object.keys(temporaryValues);
            const soql = `SELECT Id, ${obj.externalId}, ${fields.join(', ')} FROM ${obj.objectName}`;

            try {
                const records = await this.sfManager.query(this.config.target, soql);
                const csvPath = path.join(this.config.tmpDir, this.config.targetOrg || '', obj.objectName + CSV_EXTENSION);
                const csvRecords = await this.csvManager.readCsvRecords(csvPath);

                // Build externalId → real values map from the original JSON data
                const realValues = new Map();
                for (const csvRecord of csvRecords) {
                    const key = csvRecord[obj.externalId];
                    if (!key) {
                        continue;
                    }
                    const values = {};
                    for (const field of fields) {
                        if (csvRecord[field] !== undefined && csvRecord[field] !== temporaryValues[field]) {
                            values[field] = csvRecord[field];
                        }
                    }
                    if (Object.keys(values).length > 0) {
                        realValues.set(key, values);
                    }
                }

                // Match org records by externalId and build updates
                const updates = [];
                for (const record of records) {
                    const key = record[obj.externalId];
                    const real = realValues.get(key);
                    if (real) {
                        updates.push({ Id: record.Id, ...real });
                    }
                }

                if (updates.length > 0) {
                    console.log(`  📊 ${obj.objectName}: restoring ${updates.length} records`);
                    await this.sfManager.update(this.config.target, obj.objectName, updates);
                    console.log(`  ✅ ${obj.objectName}: restored`);
                } else {
                    console.log(`  ✅ ${obj.objectName}: no temporary values to restore`);
                }
            } catch (error) {
                console.warn(`  ⚠️  Failed to restore temporary values for ${obj.objectName}: ${error.message}`);
            }
        }
    }

    /**
     * Post-import: resolve self-referencing hierarchy lookups.
     *
     * SFDMU can't set self-referencing lookups during upsert (chicken-and-egg:
     * parent must exist before child can reference it). It leaves them NULL.
     * This reads the CSV for child→parent mapping, queries the target org for
     * real IDs, and updates the lookup fields.
     */
    async resolveHierarchies() {
        console.log(`\n🔗 Resolving hierarchies...`);

        for (const obj of this.config.hierarchyObjects) {
            const externalId = obj.externalId;

            for (const hierarchy of obj._hierarchy) {
                const parentField = hierarchy.fieldName; // e.g. "cgcloud__Parent__r.Name"
                const parentIdField = parentField.replace(/__r\..+$/, '__c'); // e.g. "cgcloud__Parent__c"

                // Read CSV to build child→parent external ID mapping
                const csvPath = path.join(this.config.tmpDir, this.config.targetOrg || '', obj.objectName + CSV_EXTENSION);
                const records = await this.csvManager.readCsvRecords(csvPath);

                const childParentMap = new Map();
                for (const record of records) {
                    const childId = (record[externalId] || '').trim();
                    const parentId = (record[parentField] || '').trim();
                    if (childId && parentId && childId !== parentId) {
                        childParentMap.set(childId, parentId);
                    }
                }

                if (childParentMap.size === 0) {
                    console.log(`  ✅ ${obj.objectName}.${parentField}: no hierarchies`);
                    continue;
                }

                // Query target org for real Salesforce IDs
                const allExtIds = [...new Set([...childParentMap.keys(), ...childParentMap.values()])];
                const escape = (v) => v.replace(/'/g, "\\'");
                const idsString = allExtIds.map((v) => `'${escape(v)}'`).join(', ');
                const soql = `SELECT Id, ${externalId} FROM ${obj.objectName} WHERE ${externalId} IN (${idsString})`;

                try {
                    const orgRecords = await this.sfManager.query(this.config.target, soql);

                    // Build externalId → real Id map
                    const extIdToRealId = new Map();
                    for (const r of orgRecords) {
                        extIdToRealId.set(r[externalId], r.Id);
                    }

                    // Build updates
                    const updates = [];
                    for (const [childExtId, parentExtId] of childParentMap) {
                        const childRealId = extIdToRealId.get(childExtId);
                        const parentRealId = extIdToRealId.get(parentExtId);
                        if (childRealId && parentRealId) {
                            updates.push({ Id: childRealId, [parentIdField]: parentRealId });
                        }
                    }

                    if (updates.length > 0) {
                        console.log(`  📊 ${obj.objectName}.${parentField}: updating ${updates.length} records`);
                        await this.sfManager.update(this.config.target, obj.objectName, updates);
                        console.log(`  ✅ ${obj.objectName}.${parentField}: resolved`);
                    } else {
                        console.log(`  ✅ ${obj.objectName}.${parentField}: no updates needed`);
                    }
                } catch (error) {
                    console.warn(`  ⚠️  Failed to resolve hierarchy for ${obj.objectName}.${parentField}: ${error.message}`);
                }
            }
        }
    }

    /**
     * Post-first-export: export junction objects with filtered WHERE clauses.
     *
     * Junction objects (e.g., KPI_Set_KPI_Definition) connect two parent objects.
     * After the first SFDMU run exports the parents, this method:
     * 1. Reads each parent's CSV to collect exported record values
     * 2. Builds WHERE clauses: lookup IN (parent values) AND'd together
     * 3. Adds junction objects to the full export config (all objects needed for SFDMU resolution)
     * 4. Runs a second SFDMU pass — parents re-export (same data), junctions ADD filtered records
     */
    async exportJunctions(targetDir) {
        const junctionObjects = this.config.junctionObjects;

        console.log(`\n🔗 Exporting junction objects...`);

        const junctionExportObjects = [];

        for (const obj of junctionObjects) {
            const filterClauses = [];

            for (const junction of obj._junction) {
                // Read source object's CSV to get exported values
                const csvPath = path.join(targetDir, junction.objectName + CSV_EXTENSION);
                const records = await this.csvManager.readCsvRecords(csvPath);

                if (records.length === 0) {
                    console.warn(`  ⚠️  No CSV records for ${junction.objectName}`);
                    continue;
                }

                if (junction.column) {
                    // Column mode: read specific column from source CSV, filter by this object's externalId
                    const values = [...new Set(
                        records.map((r) => r[junction.column]).filter((v) => v && v !== '#N/A')
                    )];

                    if (values.length > 0) {
                        const idsString = values.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(', ');
                        filterClauses.push(`${obj.externalId} IN (${idsString})`);
                        console.log(`  📊 ${obj.objectName}: ${values.length} values from ${junction.objectName}.${junction.column}`);
                    }
                } else {
                    // Standard junction: read parent's externalId, filter by junction lookup field
                    const parentObj = this.config.getObject(junction.objectName);
                    if (!parentObj) {
                        console.warn(`  ⚠️  Parent object ${junction.objectName} not found in config`);
                        continue;
                    }

                    const values = [...new Set(
                        records.map((r) => r[parentObj.externalId]).filter(Boolean)
                    )];

                    if (values.length > 0) {
                        const idsString = values.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(', ');
                        filterClauses.push(`${junction.lookup} IN (${idsString})`);
                        console.log(`  📊 ${obj.objectName}: ${values.length} ${junction.objectName} values for ${junction.lookup}`);
                    }
                }
            }

            if (filterClauses.length === 0) {
                console.log(`  ⏭️  ${obj.objectName}: no parent values found, skipping`);
                continue;
            }

            // Build filtered query
            const selectFrom = obj.query.split(/\s+WHERE\s+|\s+ORDER\s+BY\s+/i)[0];
            const orderByMatch = obj.query.match(/\bORDER\s+BY\s+(.+)$/i);
            const orderBy = orderByMatch ? ` ORDER BY ${orderByMatch[1]}` : '';

            // Build clean object config (strip _ properties)
            const clean = {};
            for (const [key, value] of Object.entries(obj)) {
                if (!key.startsWith('_')) {
                    clean[key] = value;
                }
            }
            clean.query = `${selectFrom} WHERE ${filterClauses.join(' AND ')}${orderBy}`;
            clean.master = true;

            junctionExportObjects.push(clean);
            console.log(`  🔗 ${obj.objectName}: filtered by ${filterClauses.length} parent conditions`);
        }

        if (junctionExportObjects.length === 0) return;

        // Add junction objects to the full export config (SFDMU needs all objects for resolution)
        const fullExport = JSON.parse(JSON.stringify(this.config.exportJson));
        fullExport.objects.push(...junctionExportObjects);

        const exportPath = path.join(targetDir, EXPORT_JSON);
        this._verboseLog('Junction export configuration', fullExport);
        await fs.writeJson(exportPath, fullExport, { spaces: 2 });

        await this.sfdmuManager.run(targetDir);
        console.log(`✅ Junction export completed`);
    }

    /**
     * Post-export: resolve #N/A lookup values by querying the org directly.
     *
     * Processes both _lookup and _hierarchy entries. Any relationship field
     * with #N/A in the CSV is queried from the source org and patched.
     *
     * This gives SFDMU the real values it needs during import
     * (e.g., Parent__r.Name = 'ActualRecord' instead of '#N/A').
     */
    async resolveAfterLookups(targetDir) {
        // Collect objects that need #N/A resolution (from _lookup or _hierarchy)
        const seen = new Set();
        const objectsToResolve = [];
        for (const obj of [...this.config.lookupObjects, ...this.config.hierarchyObjects]) {
            if (!seen.has(obj.objectName)) {
                seen.add(obj.objectName);
                objectsToResolve.push(obj);
            }
        }

        if (objectsToResolve.length === 0) return;

        console.log(`\n🔗 Resolving lookup values...`);

        for (const obj of objectsToResolve) {
            const fieldNames = [
                ...(obj._lookup || []).map((l) => l.fieldName),
                ...(obj._hierarchy || []).map((l) => l.fieldName),
            ];

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
            // Handle compound externalIds (semicolon-separated, e.g. "Parent__r.Name;Child__r.Name")
            const externalIdParts = obj.externalId.split(';');
            const isCompound = externalIdParts.length > 1;
            const selectFields = [...new Set([...externalIdParts, ...fieldNames])];
            const escape = (v) => v.replace(/'/g, "\\'");

            // Batch the query if too many IDs (SOQL has ~20K char limit)
            const BATCH_SIZE = 200;
            const valueMap = new Map();

            for (let i = 0; i < idsWithNA.length; i += BATCH_SIZE) {
                const batch = idsWithNA.slice(i, i + BATCH_SIZE);
                let soql;

                if (isCompound) {
                    // Split compound keys into per-field value sets, query with AND'd IN clauses
                    const fieldValueSets = externalIdParts.map(() => new Set());
                    for (const key of batch) {
                        const parts = key.split(';');
                        parts.forEach((part, idx) => fieldValueSets[idx].add(part));
                    }
                    const whereClauses = externalIdParts.map((field, idx) => {
                        const vals = [...fieldValueSets[idx]].map((v) => `'${escape(v)}'`).join(', ');
                        return `${field} IN (${vals})`;
                    });
                    soql = `SELECT ${selectFields.join(', ')} FROM ${obj.objectName} WHERE ${whereClauses.join(' AND ')}`;
                } else {
                    const idsString = batch.map((v) => `'${escape(v)}'`).join(', ');
                    soql = `SELECT ${selectFields.join(', ')} FROM ${obj.objectName} WHERE ${obj.externalId} IN (${idsString})`;
                }

                try {
                    const orgRecords = await this.sfManager.query(this.config.source, soql);

                    for (const orgRecord of orgRecords) {
                        // Reconstruct compound key from individual fields
                        const key = isCompound
                            ? externalIdParts.map((part) => this._extractNestedField(orgRecord, part)).join(';')
                            : orgRecord[obj.externalId] || this._extractNestedField(orgRecord, obj.externalId);
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
     * Log a JSON object when verbose mode is enabled.
     */
    _verboseLog(label, data) {
        if (this.config.verbose) {
            console.log(`${label}:`, JSON.stringify(data, null, 2));
        }
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
