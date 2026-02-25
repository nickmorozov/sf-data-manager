// lib/sf.js
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const APEX_UPDATE_SELF_LOOKUPS = 'updateSelfLookups.apex';

class SfManager {
    constructor(config) {
        this.config = config;
        this.templateDir = path.resolve(__dirname, '..', 'templates');
    }

    /**
     * Generate an Apex script to update child KPI definitions.
     * @param targetDir
     * @param {Object} objectConfig - Configuration object for the Salesforce object.
     * @param {Object} childParentMapping - Object containing childParentMap and allKpiNames.
     */
    async generateSelfLookupsScript(targetDir, objectConfig, childParentMapping) {
        const { childParentMap, allExternalIds } = childParentMapping;

        // Convert to Apex-compatible format
        const apexAllNames = allExternalIds.map((name) => `'${name.replace(/'/g, "\\'")}'`).join(', ');
        const apexChildParentEntries = Object.entries(childParentMap)
            .map(([child, parent]) => `'${child.replace(/'/g, "\\'")}' => '${parent.replace(/'/g, "\\'")}'`)
            .join(', ');

        // Read the template file
        const templateContent = this.getTemplateContent(APEX_UPDATE_SELF_LOOKUPS);

        // Replace placeholders with actual values
        const apexScript = templateContent
            .replaceAll('{{OBJECT_NAME}}', objectConfig.objectName)
            .replaceAll('{{CHILD_NAME}}', objectConfig.hierarchy.childField)
            .replaceAll('{{PARENT_NAME}}', objectConfig.hierarchy.parentIdField)
            .replace('{{ALL_EXTERNAL_IDS}}', apexAllNames)
            .replace('{{CHILD_PARENT_MAP}}', apexChildParentEntries);

        const generatedApexPath = path.join(targetDir, APEX_UPDATE_SELF_LOOKUPS);

        fs.writeFileSync(generatedApexPath, apexScript);

        return generatedApexPath;
    }

    getTemplateContent(templateName) {
        const templatePath = path.join(this.templateDir, templateName);
        return fs.readFileSync(templatePath, 'utf8');
    }

    /**
     * Query all Sales Organization codes from the source org
     * @param {string} sourceOrg - Source org alias
     * @returns {Promise<string[]>} Array of sales org codes
     */
    async querySalesOrgs(sourceOrg) {
        try {
            const query = 'SELECT cgcloud__Sales_Org_Value__c FROM cgcloud__Sales_Organization__c ORDER BY cgcloud__Sales_Org_Value__c';
            const command = `sf data query --query "${query}" --target-org "${sourceOrg}" --json`;
            const { stdout } = await execAsync(command, { timeout: this.config.timeout });
            const result = JSON.parse(stdout);

            if (result.status !== 0 || !result.result?.records) {
                return [];
            }

            return result.result.records.map((r) => r.cgcloud__Sales_Org_Value__c).filter(Boolean);
        } catch (error) {
            console.error(`❌ Failed to query sales organizations: ${error.message}`);
            throw error;
        }
    }

    /**
     * Run an Apex script using Salesforce CLI
     * @param {string} apexScriptPath - Path to the Apex script file
     * @returns {Promise<string>} - Output from the CLI
     */
    async runApex(apexScriptPath) {
        if (!apexScriptPath || !this.config.target) {
            throw new Error('Apex script path and target username are required');
        }

        try {
            console.log(`\n🚀 Running Apex script: ${apexScriptPath} on org: ${this.config.target}`);

            const command = `sf apex run --file "${apexScriptPath}" --target-org "${this.config.target}" --json`;
            const { stdout } = await execAsync(command, { timeout: this.config.timeout });

            console.log('Apex script executed successfully.');
            return stdout;
        } catch (error) {
            console.error(`❌ Failed to run Apex script: ${error.message}`);
            throw error;
        }
    }
}

module.exports = { SfManager };
