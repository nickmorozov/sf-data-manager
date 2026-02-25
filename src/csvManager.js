const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse');

const { CSV_EXTENSION, LINE_REPEAT } = require('./../config/constants');

const DML_OPERATIONS = ['insert', 'delete', 'update', 'upsert'];
const CSV_ISSUES_REPORT = 'CSVIssuesReport' + CSV_EXTENSION;
const MISSING_LOOKUPS_REPORT = 'MissingParentRecordsReport' + CSV_EXTENSION;

class CsvManager {
    constructor(config) {
        this.config = config;
    }

    async parseSalesOrgs(salesOrgObject) {
        const salesOrgsCsvPath = path.join(this.config.tmpDir, salesOrgObject.objectName + CSV_EXTENSION);

        if (!(await fs.pathExists(salesOrgsCsvPath))) {
            throw new Error('Sales organizations file not found');
        }

        return new Promise((resolve, reject) => {
            const allSalesOrgs = [];

            fs.createReadStream(salesOrgsCsvPath)
                .pipe(parse({ columns: true, bom: true }))
                .on('data', (row) => {
                    const value = row[salesOrgObject.externalId];
                    if (value && value.trim()) {
                        allSalesOrgs.push(value.trim());
                    }
                })
                .on('end', () => resolve(allSalesOrgs))
                .on('error', reject);
        });
    }

    async getChildParentMapping(targetDir, objectConfig) {
        const csvPath = path.join(targetDir, objectConfig.objectName + CSV_EXTENSION);
        if (!(await fs.pathExists(csvPath))) {
            throw new Error(csvPath + ' not found');
        }

        return new Promise((resolve, reject) => {
            const childParentMap = new Map(); // child name -> parent name
            const allExternalIds = new Set(); // all externalIds from CSV

            fs.createReadStream(csvPath)
                .pipe(parse({ columns: true, bom: true }))
                .on('data', (row) => {
                    const childName = row[objectConfig.hierarchy.childField]?.trim();
                    const parentName = row[objectConfig.hierarchy.parentField]?.trim();

                    if (childName && parentName) {
                        childParentMap.set(childName, parentName);
                        allExternalIds.add(childName);
                        allExternalIds.add(parentName);
                    }
                })
                .on('end', () =>
                    resolve({
                        childParentMap: Object.fromEntries(childParentMap),
                        allExternalIds: Array.from(allExternalIds)
                    })
                )
                .on('error', reject);
        });
    }

    /**
     * Extract KPI Set names from KPI_Map CSV files for a specific sales org
     */
    async getParentExternalIdsFromSalesOrg(targetDir, parentConfig) {
        const objectCsv = path.join(targetDir, parentConfig.objectName + CSV_EXTENSION);

        if (!(await fs.pathExists(objectCsv))) {
            console.log(`⚠️ ${objectCsv} not found, skipping KPI Set export`);
            return [];
        }

        return new Promise((resolve, reject) => {
            const externalIds = new Set();

            fs.createReadStream(objectCsv)
                .pipe(parse({ columns: true, bom: true }))
                .on('data', (row) => {
                    const externalId = row[parentConfig.externalId];
                    if (externalId) {
                        externalIds.add(externalId);
                    }
                })
                .on('end', () => {
                    resolve(Array.from(externalIds));
                })
                .on('error', reject);
        });
    }

    /**
     * Read all records from a CSV file
     */
    async readCsvRecords(csvPath) {
        if (!(await fs.pathExists(csvPath))) return [];

        return new Promise((resolve, reject) => {
            const records = [];
            fs.createReadStream(csvPath)
                .pipe(parse({ columns: true, bom: true }))
                .on('data', (row) => records.push(row))
                .on('end', () => resolve(records))
                .on('error', reject);
        });
    }

    /**
     * Parse filename to extract object type and operation
     */
    parseFilename(filename) {
        // Remove .csv extension
        const nameWithoutExt = filename.replace(CSV_EXTENSION, '');

        // Split by underscore and find the operation (insert/delete/update) and target
        const parts = nameWithoutExt.split('_');

        let operation = '';
        let objectType = '';

        // Look for known operations
        const operations = DML_OPERATIONS;
        const operationIndex = parts.findIndex((part) => operations.includes(part.toLowerCase()));

        if (operationIndex !== -1) {
            operation = parts[operationIndex].toUpperCase();
            objectType = parts.slice(0, operationIndex).join('_');
        }

        return { objectType, operation };
    }

    /**
     * Analyze a single CSV file for errors
     */
    async analyzeCSVForErrors(filePath) {
        const filename = path.basename(filePath);
        const { objectType, operation } = this.parseFilename(filename);

        if (!objectType || !operation) {
            console.log(`⚠️ Could not parse filename: ${filename}`);
            return null;
        }

        return new Promise((resolve, reject) => {
            const errors = [];
            let totalRecords = 0;

            fs.createReadStream(filePath)
                .pipe(parse({ columns: true, bom: true }))
                .on('data', (row) => {
                    totalRecords++;
                    const errorText = row['Errors']?.toString().trim();
                    const recordName = row['Name'] || row['Id'] || `Record ${totalRecords}`;

                    if (errorText) {
                        errors.push({
                            recordName,
                            error: errorText.toString().trim()
                        });
                    }
                })
                .on('end', () => {
                    resolve({
                        objectType,
                        operation,
                        totalRecords,
                        errors,
                        filename
                    });
                })
                .on('error', reject);
        });
    }

    /**
     * Parse CSVIssuesReport.csv for CSV-related errors
     */
    async parseCSVIssuesReport(salesOrgDir) {
        const reportPath = path.join(salesOrgDir, CSV_ISSUES_REPORT);

        if (!(await fs.pathExists(reportPath))) {
            return { issues: [], totalIssues: 0 };
        }

        return new Promise((resolve, reject) => {
            const issues = [];

            fs.createReadStream(reportPath)
                .pipe(parse({ columns: true, bom: true }))
                .on('data', (row) => {
                    const issue = {
                        dateUpdate: row['Date update'],
                        error: row['Error'],
                        fieldName: row['Field name'],
                        fieldValue: row['Field value'],
                        parentFieldName: row['Parent field name'],
                        parentFieldValue: row['Parent field value'],
                        parentSObjectName: row['Parent SObject name'],
                        sObjectName: row['sObject name']
                    };

                    if (issue.error || issue.sObjectName) {
                        issues.push(issue);
                    }
                })
                .on('end', () => resolve({ issues, totalIssues: issues.length }))
                .on('error', reject);
        });
    }

    /**
     * Parse MissingParentRecordsReport.csv for missing parent record errors
     */
    async parseMissingParentRecordsReport(salesOrgDir) {
        const reportPath = path.join(salesOrgDir, MISSING_LOOKUPS_REPORT);

        if (!(await fs.pathExists(reportPath))) {
            return { missingRecords: [], totalMissing: 0 };
        }

        return new Promise((resolve, reject) => {
            const missingRecords = [];

            fs.createReadStream(reportPath)
                .pipe(parse({ columns: true, bom: true }))
                .on('data', (row) => {
                    const missing = {
                        dateUpdate: row['Date update'],
                        lookupFieldName: row['Lookup field name'],
                        lookupReferenceFieldName: row['Lookup reference field name'],
                        missingParentExternalId: row['Missing parent External Id value'],
                        parentExternalIdFieldName: row['Parent ExternalId field name'],
                        parentSObjectName: row['Parent SObject name'],
                        recordId: row['Record Id'],
                        sObjectName: row['sObject name']
                    };

                    if (missing.missingParentExternalId || missing.recordId) {
                        missingRecords.push(missing);
                    }
                })
                .on('end', () => resolve({ missingRecords, totalMissing: missingRecords.length }))
                .on('error', reject);
        });
    }

    /**
     * Print errors from all CSV files in a directory (looking in target subdirectory)
     */
    async printCSVErrors(salesOrgDir) {
        try {
            // Look for CSV files in the target subdirectory
            const targetDir = path.join(salesOrgDir, 'target');

            if (!(await fs.pathExists(targetDir))) {
                console.log(`No target directory found: ${targetDir}`);
                return;
            }

            // Get all CSV files in the target directory
            const files = await fs.readdir(targetDir);
            const csvFiles = files.filter((file) => file.toLowerCase().endsWith(CSV_EXTENSION));

            const results = [];
            let totalErrors = 0;
            let totalRecords = 0;

            // Analyze each CSV file for standard SFDMU errors
            for (const csvFile of csvFiles) {
                const filePath = path.join(targetDir, csvFile);
                const result = await this.analyzeCSVForErrors(filePath);

                if (result) {
                    results.push(result);
                    totalErrors += result.errors.length;
                    totalRecords += result.totalRecords;

                    if (result.errors.length > 0) {
                        // Print results for this file
                        console.log(`\n=== ${result.objectType} (${result.operation} ${result.totalRecords} records) ===`);
                        console.log(`${result.errors.length} errors:`);

                        result.errors.forEach((error) => {
                            // Clean up HTML tags from error messages for better readability
                            const cleanError = error.error
                                .replace(/<br\s*\/?>/gi, ' | ')
                                .replace(/<[^>]*>/g, '')
                                .replace(/\s+/g, ' ')
                                .trim();
                            console.log(`❌ ${error.recordName}: ${cleanError}`);
                        });
                    }
                }
            }

            // Parse and display CSV Issues Report
            const csvIssuesReport = await this.parseCSVIssuesReport(salesOrgDir);
            if (csvIssuesReport.totalIssues > 0) {
                console.log(`\n=== CSV ISSUES REPORT ===`);
                console.log(`Total issues: ${csvIssuesReport.totalIssues}`);

                csvIssuesReport.issues.forEach((issue) => {
                    console.log(`❌ ${issue.sObjectName} (${issue.fieldName}): ${issue.error}`);
                    if (issue.fieldValue) {
                        console.log(`   Field Value: ${issue.fieldValue}`);
                    }
                });

                totalErrors += csvIssuesReport.totalIssues;
            }

            // Parse and display Missing Parent Records Report
            const missingParentReport = await this.parseMissingParentRecordsReport(salesOrgDir);
            if (missingParentReport.totalMissing > 0) {
                console.log(`\n=== MISSING PARENT RECORDS REPORT ===`);
                console.log(`Total missing parent records: ${missingParentReport.totalMissing}`);

                // Group by parent object for better readability
                const groupedByParent = {};
                missingParentReport.missingRecords.forEach((missing) => {
                    const key = `${missing.parentSObjectName} -> ${missing.sObjectName}`;
                    if (!groupedByParent[key]) {
                        groupedByParent[key] = [];
                    }
                    groupedByParent[key].push(missing);
                });

                Object.keys(groupedByParent).forEach((relationship) => {
                    const records = groupedByParent[relationship];
                    console.log(`\n📋 ${relationship} (${records.length} missing):`);

                    // Show up to 10 examples to avoid overwhelming output
                    const displayRecords = records.slice(0, 10);
                    displayRecords.forEach((missing) => {
                        console.log(`   ❌ ${missing.recordId}: Missing ${missing.parentExternalIdFieldName} = "${missing.missingParentExternalId}"`);
                    });

                    if (records.length > 10) {
                        console.log(`   ... and ${records.length - 10} more records`);
                    }
                });

                totalErrors += missingParentReport.totalMissing;
            }

            // Print summary
            console.log('\n📊 SUMMARY');
            console.log('='.repeat(LINE_REPEAT));

            results.forEach((result) => {
                console.log(`${result.objectType} (${result.operation}): ${result.errors.length}/${result.totalRecords} errors`);
            });

            if (csvIssuesReport.totalIssues > 0) {
                console.log(`CSV Issues: ${csvIssuesReport.totalIssues} issues`);
            }

            if (missingParentReport.totalMissing > 0) {
                console.log(`Missing Parent Records: ${missingParentReport.totalMissing} missing`);
            }

            console.log(`\nOverall: ${totalErrors} total errors/issues`);
            if (totalRecords > 0) {
                console.log(`Records processed: ${totalRecords}`);
            }

            if (totalErrors === 0) {
                console.log('🎉 All operations completed successfully with no errors!');
            } else {
                console.log(`⚠️  ${totalErrors} errors/issues found`);
            }
        } catch (error) {
            console.error(`❌ Error analyzing CSV files: ${error.message}`);
            throw error;
        }
    }
}

module.exports = {
    CsvManager
};
