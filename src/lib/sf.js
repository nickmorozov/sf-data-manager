// lib/sf.js
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class SfManager {
    constructor(config) {
        this.config = config;
    }

    /**
     * Run a SOQL query against a Salesforce org and return records.
     * @param {string} org - Org alias
     * @param {string} soqlQuery - SOQL query string
     * @returns {Promise<Object[]>} Array of record objects
     */
    async query(org, soqlQuery) {
        try {
            const command = `sf data query --query "${soqlQuery}" --target-org "${org}" --json`;
            const { stdout } = await execAsync(command, { timeout: this.config.timeout });
            const result = JSON.parse(stdout);

            if (result.status !== 0 || !result.result?.records) {
                return [];
            }

            return result.result.records;
        } catch (error) {
            console.error(`❌ Query failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Query all Sales Organization codes from the source org
     * @param {string} sourceOrg - Source org alias
     * @param {Object} salesOrgObject - Sales org object config from YAML (objectName, externalId)
     * @returns {Promise<string[]>} Array of sales org codes
     */
    async querySalesOrgs(sourceOrg, salesOrgObject) {
        try {
            const query = `SELECT ${salesOrgObject.externalId} FROM ${salesOrgObject.objectName} ORDER BY ${salesOrgObject.externalId}`;
            const command = `sf data query --query "${query}" --target-org "${sourceOrg}" --json`;
            const { stdout } = await execAsync(command, { timeout: this.config.timeout });
            const result = JSON.parse(stdout);

            if (result.status !== 0 || !result.result?.records) {
                return [];
            }

            return result.result.records.map((r) => r[salesOrgObject.externalId]).filter(Boolean);
        } catch (error) {
            console.error(`❌ Failed to query sales organizations: ${error.message}`);
            throw error;
        }
    }
}

module.exports = { SfManager };
