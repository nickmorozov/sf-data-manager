const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse');

const { CSV_EXTENSION } = require('../config/constants');
const JSON_EXTENSION = '.json';

const SALES_ORG_FIELDS = [
    'cgcloud__Sales_Org_Value__c',
    'cgcloud__Sales_Org__c',
    'cgcloud__Sales_Org__r.cgcloud__Sales_Org_Value__c',
    'cgcloud__Sales_Organization__r.cgcloud__Sales_Org_Value__c',
    'cgcloud__Unique_Key__c'
];

class JsonConverter {
    constructor(config) {
        this.config = config;
    }

    async csvToJson() {
        console.log('🏢 Converting Sales Org CSV files to JSON...');

        for (const salesOrg of this.config.salesOrgs) {
            await this.convertSalesOrgCsvToJson(salesOrg.source);
        }

        console.log('✅ CSV to JSON conversion completed');
    }

    async convertSalesOrgCsvToJson(sourceOrg) {
        if (this.config.verbose) {
            console.log(`📁 Converting Sales Org ${sourceOrg} CSV files to JSON...`);
        }

        const inputDir = path.join(this.config.tmpDir, sourceOrg);
        const outputDir = path.join(this.config.dataDir, sourceOrg);

        if (!(await fs.pathExists(inputDir))) {
            console.log(`⚠️  Sales Org directory ${sourceOrg} not found, skipping...`);
            return;
        }

        // Remove existing directory if it exists to refresh JSON files
        if (await fs.pathExists(outputDir)) {
            await fs.remove(outputDir);
        }

        // Create JSON directory for the sales org
        await fs.ensureDir(outputDir);

        const csvFiles = await fs.readdir(inputDir);

        for (const file of csvFiles) {
            if (file.endsWith(CSV_EXTENSION)) {
                const csvPath = path.join(inputDir, file);
                const objectName = path.basename(file, CSV_EXTENSION);

                // Skip if not a valid object
                const objectConfig = this.config.getObject(objectName);

                if (!objectConfig) {
                    continue;
                }

                await this.convertCsvFileToJson(csvPath, objectConfig, sourceOrg);
            }
        }
    }

    async convertCsvFileToJson(csvPath, objectConfig, salesOrg) {
        if (this.config.verbose) {
            console.log(`  📄 Converting ${objectConfig.objectName}${salesOrg ? ` (${salesOrg})` : ''}...`);
        }

        if (!objectConfig) {
            return null;
        }

        const outputDir = path.join(this.config.dataDir, salesOrg, objectConfig.objectName);

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
                        for (const record of records) {
                            const externalId = this.getExternalIdValue(record, objectConfig);
                            if (externalId) {
                                const fileName = this.sanitizeFileName(externalId);
                                const jsonPath = path.join(outputDir, `${fileName}${JSON_EXTENSION}`);
                                await fs.writeJson(jsonPath, record, { spaces: 2 });
                            }
                        }

                        if (records.length === 0) {
                            fs.remove(outputDir); // Remove empty CSV file
                            fs.remove(csvPath); // Remove empty JSON dir
                        }

                        if (this.config.verbose) {
                            console.log(`    ✅ Converted ${records.length} records for ${objectConfig.objectName}`);
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

        for (const salesOrg of this.config.salesOrgs) {
            await this.convertSalesOrgJsonToCsv(salesOrg);
        }

        console.log('✅ JSON to CSV conversion completed');
    }

    async convertSalesOrgJsonToCsv(salesOrg) {
        if (this.config.verbose) {
            console.log(`📁 Converting Sales Org ${salesOrg.source} JSON files to CSV (target: ${salesOrg.target})...`);
        }

        const inputDir = path.join(this.config.dataDir, salesOrg.source);
        const outputDir = path.join(this.config.tmpDir, salesOrg.target);

        if (!(await fs.pathExists(inputDir))) {
            console.log(`⚠️  Sales Org JSON directory ${salesOrg.source} not found, skipping...`);
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
            console.log(`  📄 Converting ${objectName} (${salesOrg.source} → ${salesOrg.target})...`);
        }

        const jsonFiles = await fs.readdir(jsonDir);
        const records = [];

        for (const file of jsonFiles) {
            if (file.endsWith(JSON_EXTENSION)) {
                const jsonPath = path.join(jsonDir, file);
                const record = await fs.readJson(jsonPath);

                // Force pushable to false on first import
                if (file.includes(objectName) && !this.config.madeTemporaryImport) {
                    const objectConfig = this.config.getObject(objectName);

                    for (const [fieldName, temporaryValue] of Object.entries(objectConfig?.temporaryValues || {})) {
                        if (record.hasOwnProperty(fieldName) && record[fieldName] !== temporaryValue) {
                            record[fieldName] = temporaryValue;
                            this.config.needTemporaryImport = true;
                        }
                    }
                }

                // Transform record if target sales org is specified
                this.transformRecordForTargetSalesOrg(record, salesOrg);

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
            )
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
    JsonConverter
};
