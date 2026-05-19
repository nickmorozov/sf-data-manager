const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse');

const { CSV_EXTENSION } = require('./config/constants');
const JSON_EXTENSION = '.json';

const SALES_ORG_FIELDS = [
    'Name',
    'cgcloud__Sales_Org_Value__c',
    'cgcloud__Sales_Org__c',
    'cgcloud__Sales_Org__r.cgcloud__Sales_Org_Value__c',
    'cgcloud__Sales_Organization__r.cgcloud__Sales_Org_Value__c',
    'cgcloud__Unique_Key__c',
];

// Objects managed by SFDMU addons (e.g. core:ExportFiles) — not declared in config but
// emitted as CSVs in tmp/. Converted wholesale to a single JSON array per object so they
// can be version-controlled alongside per-record data.
const ADDON_MANAGED_OBJECTS = new Set(['Attachment', 'ContentDocumentLink', 'ContentVersion', 'Note']);
const ADDON_BUNDLE_FILENAME = '_addon-records.json';

class JsonConverter {
    constructor(config) {
        this.config = config;
    }

    async csvToJson() {
        console.log('📁 Converting CSV files to JSON...');

        // Remove existing directory if it exists to refresh JSON files
        if (await fs.pathExists(this.config.dataDir)) {
            await fs.remove(this.config.dataDir);
        }

        await fs.ensureDir(this.config.dataDir);

        if (this.config.hasSalesOrgs) {
            for (const salesOrg of this.config.salesOrgs) {
                await this.convertCsvDirToJson(path.join(this.config.tmpDir, salesOrg.source), path.join(this.config.dataDir, salesOrg.source));
            }
        } else {
            await this.convertCsvDirToJson(this.config.tmpDir, this.config.dataDir);
        }

        console.log('✅ CSV to JSON conversion completed');
    }

    async convertCsvDirToJson(inputDir, baseOutputDir) {
        if (!(await fs.pathExists(inputDir))) {
            console.log(`⚠️  CSV directory ${inputDir} not found, skipping...`);
            return;
        }

        // Create JSON directory for the sales org
        await fs.ensureDir(baseOutputDir);

        const csvFiles = await fs.readdir(inputDir);
        const exportFilesAddonPresent = this.hasExportFilesAddon();

        for (const file of csvFiles) {
            if (file.endsWith(CSV_EXTENSION)) {
                const csvPath = path.join(inputDir, file);
                const objectName = path.basename(file, CSV_EXTENSION);

                // Skip if not a valid object
                const objectConfig = this.config.getObject(objectName);

                if (!objectConfig) {
                    if (exportFilesAddonPresent && ADDON_MANAGED_OBJECTS.has(objectName)) {
                        await this.convertAddonCsvToJson(csvPath, objectName, baseOutputDir);
                        continue;
                    }
                    console.error(`Invalid object name: ${objectName}`);
                    continue;
                }

                await this.convertCsvFileToJson(csvPath, objectConfig, baseOutputDir);
            }
        }
    }

    hasExportFilesAddon() {
        const rawObjects = (this.config._rawConfig && this.config._rawConfig.objects) || [];
        return rawObjects.some((obj) => (obj.afterAddons || []).some((a) => a && a.module === 'core:ExportFiles'));
    }

    async convertAddonCsvToJson(csvPath, objectName, baseOutputDir) {
        const outputDir = path.join(baseOutputDir, objectName);
        await fs.ensureDir(outputDir);

        return new Promise((resolve, reject) => {
            const records = [];
            fs.createReadStream(csvPath)
                .pipe(parse({ columns: true, bom: true }))
                .on('data', (row) => records.push(row))
                .on('end', async () => {
                    try {
                        const jsonPath = path.join(outputDir, ADDON_BUNDLE_FILENAME);
                        await fs.writeFile(jsonPath, JSON.stringify(records, null, 4) + '\n');
                        if (this.config.verbose) {
                            console.log(`    ✅ Converted ${records.length} addon-managed records for ${objectName}`);
                        }
                        if (records.length === 0) {
                            await fs.remove(outputDir);
                            await fs.remove(csvPath);
                        }
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                })
                .on('error', reject);
        });
    }

    async convertCsvFileToJson(csvPath, objectConfig, baseOutputDir) {
        if (!objectConfig) {
            return null;
        }

        if (this.config.verbose) {
            console.log(`  📄 Converting ${objectConfig.objectName}...`);
        }

        const outputDir = path.join(baseOutputDir, objectConfig.objectName);

        // Make sure output directory exists for the object
        await fs.ensureDir(outputDir);

        const records = [];

        // Read CSV file
        return new Promise((resolve, reject) => {
            fs.createReadStream(csvPath)
                .pipe(parse({ columns: true, bom: true }))
                .on('data', (row) => {
                    records.push(row);
                })
                .on('end', async () => {
                    try {
                        // Convert each record to JSON file
                        let converted = 0;
                        let skipped = 0;
                        for (const record of records) {
                            const externalId = this.getExternalIdValue(record, objectConfig);
                            if (externalId) {
                                const fileName = this.sanitizeFileName(externalId);
                                const jsonPath = path.join(outputDir, `${fileName}${JSON_EXTENSION}`);
                                await fs.writeFile(jsonPath, JSON.stringify(record, null, 4) + '\n');
                                converted++;
                            } else {
                                skipped++;
                                // Show identifiable fields so user can investigate
                                const hints = Object.entries(record)
                                    .filter(([k, v]) => {
                                        const isDescription = k.includes('Description');
                                        const isExternalId = k.includes('External_Id');
                                        const isName = k === 'Name';

                                        return v && (isName || isDescription || isExternalId);
                                    })
                                    .map(([k, v]) => `${k}=${v}`)
                                    .slice(0, 3);
                                console.warn(
                                    `    ⚠️  ${objectConfig.objectName}: skipped record — empty external ID (${objectConfig.externalId})${hints.length ? ' | ' + hints.join(', ') : ''}`
                                );
                            }
                        }

                        if (skipped > 0) {
                            console.warn(`    ⚠️  ${objectConfig.objectName}: ${skipped}/${records.length} records skipped (empty external ID: ${objectConfig.externalId})`);
                        }

                        if (records.length === 0) {
                            fs.remove(outputDir); // Remove empty CSV file
                            fs.remove(csvPath); // Remove empty JSON dir
                        }

                        if (this.config.verbose) {
                            console.log(`    ✅ Converted ${converted} records for ${objectConfig.objectName}`);
                        }

                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                })
                .on('error', reject);
        });
    }

    async jsonToCsv() {
        console.log('🔄 Converting JSON files to CSV...');

        if (this.config.hasSalesOrgs) {
            for (const salesOrg of this.config.salesOrgs) {
                await this.convertJsonDirToCsv(path.join(this.config.dataDir, salesOrg.source), path.join(this.config.tmpDir, salesOrg.target), salesOrg);
            }
        } else {
            await this.convertJsonDirToCsv(this.config.dataDir, this.config.tmpDir);
        }

        console.log('✅ JSON to CSV conversion completed');
    }

    async convertJsonDirToCsv(inputDir, outputDir, salesOrg) {
        if (!(await fs.pathExists(inputDir))) {
            console.log(`⚠️  JSON directory ${inputDir} not found, skipping...`);
            return;
        }

        await fs.ensureDir(outputDir);

        const objectDirs = await fs.readdir(inputDir, { withFileTypes: true });

        for (const entry of objectDirs) {
            if (entry.isDirectory()) {
                const objectName = entry.name;
                const jsonDir = path.join(inputDir, objectName);
                const csvPath = path.join(outputDir, objectName + CSV_EXTENSION);

                await this.convertJsonDirectoryToCsv(jsonDir, csvPath, objectName, salesOrg);
            }
        }
    }

    async convertJsonDirectoryToCsv(jsonDir, csvPath, objectName, salesOrg) {
        if (this.config.verbose) {
            console.log(`  📄 Converting ${objectName}...`);
        }

        // Addon-managed objects store all records in a single bundle file
        if (ADDON_MANAGED_OBJECTS.has(objectName)) {
            const bundlePath = path.join(jsonDir, ADDON_BUNDLE_FILENAME);
            if (await fs.pathExists(bundlePath)) {
                const records = await fs.readJson(bundlePath);
                if (Array.isArray(records) && records.length > 0) {
                    await this.writeRecordsToCsv(records, csvPath);
                    if (this.config.verbose) {
                        console.log(`    ✅ Converted ${records.length} addon-managed records for ${objectName}`);
                    }
                }
                return;
            }
        }

        const jsonFiles = await fs.readdir(jsonDir);
        const records = [];

        for (const file of jsonFiles) {
            if (file.endsWith(JSON_EXTENSION)) {
                const jsonPath = path.join(jsonDir, file);
                const record = await fs.readJson(jsonPath);

                // Force temporary values on import (e.g. pushable=false)
                // Real values are restored after SFDMU completes via restoreTemporaryValues()
                const meta = this.config.getObjectMeta(objectName);
                for (const [fieldName, temporaryValue] of Object.entries(meta?._temporaryValues || {})) {
                    if (record.hasOwnProperty(fieldName) && record[fieldName] !== temporaryValue) {
                        record[fieldName] = temporaryValue;
                        this.config.needTemporaryImport = true;
                    }
                }

                // Transform record if target sales org is specified
                if (salesOrg) {
                    this.transformRecordForTargetSalesOrg(record, salesOrg);
                }

                records.push(record);
            }
        }

        if (records.length === 0) {
            console.log(`    ⚠️  No records found for ${objectName}, skipping...`);
            return;
        }

        // Write CSV file
        await this.writeRecordsToCsv(records, csvPath);
        if (this.config.verbose) {
            console.log(`    ✅ Converted ${records.length} records for ${objectName}`);
        }
    }

    async writeRecordsToCsv(records, csvPath) {
        if (records.length === 0) {
            return;
        }

        // Get all unique headers
        const headers = new Set();
        records.forEach((record) => {
            Object.keys(record).forEach((key) => headers.add(key));
        });

        const headerArray = Array.from(headers);
        const csvContent = [
            headerArray.join(','),
            ...records.map((record) =>
                headerArray
                    .map((header) => {
                        const value = record[header] || '';
                        // Escape quotes and wrap in quotes if contains comma or quote
                        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                            return `"${value.replace(/"/g, '""')}"`;
                        }
                        return value;
                    })
                    .join(',')
            ),
        ].join('\n');

        await fs.writeFile(csvPath, csvContent);
    }

    transformRecordForTargetSalesOrg(record, salesOrg) {
        if (salesOrg.source === salesOrg.target) {
            return; // No transformation needed if source and target are the same
        }

        // Transform sales org fields to target sales org
        for (const field of SALES_ORG_FIELDS) {
            if (record[field] && record[field].includes(salesOrg.source)) {
                record[field] = record[field].replaceAll(salesOrg.source, salesOrg.target);
            }
        }
    }

    getExternalIdValue(record, objectConfig) {
        const externalIdField = objectConfig.externalId;

        if (externalIdField.includes(';')) {
            // Compound external ID - build value from individual fields
            const fields = externalIdField.split(';');
            const values = fields.map((f) => record[f]);
            if (values.every(Boolean)) {
                return values.join('_');
            }
            // Fallback: use non-empty fields when some are missing
            const nonEmpty = values.filter(Boolean);
            if (nonEmpty.length > 0) {
                const missing = fields.filter((f) => !record[f]);
                console.warn(`    ⚠️  ${objectConfig.objectName}: partial compound ID — empty: ${missing.join(', ')}; using: ${nonEmpty.join('_')}`);
                return nonEmpty.join('_');
            }
            return null;
        } else {
            // Single external ID
            return record[externalIdField] || null;
        }
    }

    sanitizeFileName(fileName) {
        // Remove or replace invalid file name characters
        return fileName.replace(/[<>:"/\\|?* ]/g, '_').replace(/\s+/g, '_');
    }
}

module.exports = {
    JsonConverter,
};
