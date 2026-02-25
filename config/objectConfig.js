const { SALES_ORGS_SLUG } = require('./constants');

class ObjectConfig {
    constructor(config, objectConfig) {
        this.config = config;
        Object.assign(this, objectConfig);
    }

    get query() {
        let query = `SELECT ${this.fields} FROM ${this.objectName}`;

        if (this.where) {
            const salesOrgsString = this.config.salesOrgs?.map((salesOrgs) => `'${this.config.isExport ? salesOrgs.source : salesOrgs.target}'`).join(', ');

            const isSalesOrgObject = this.config._salesOrgObject && this.objectName === this.config._salesOrgObject.objectName;
            // For sales org object, if no sales orgs specified, don't add WHERE clause to get all
            if ((isSalesOrgObject && !salesOrgsString) || this.config.isList) {
                // Skip WHERE clause to get all sales organizations
            } else if (this.where.includes(SALES_ORGS_SLUG)) {
                // Only add WHERE clause if we have sales orgs for SALES_ORGS dependent queries
                if (salesOrgsString) {
                    const whereClause = this.where.replaceAll(SALES_ORGS_SLUG, this.config.targetOrg ? `'${this.config.targetOrg}'` : salesOrgsString);
                    query += ` WHERE ${whereClause}`;
                }
                // Skip WHERE clause if no sales orgs for SALES_ORGS dependent queries
            } else {
                // Add WHERE clause for non-SALES_ORGS dependent queries
                query += ` WHERE ${this.where}`;
            }
        }

        return query + ` ORDER BY ${this.orderBy}`;
    }

    get master() {
        return this.isMaster !== false || Boolean(this.where);
    }

    init() {
        return {
            query: this.query,
            externalId: this.externalId,
            operation: this.operation || 'Upsert',
            master: this.master,
            excludedFields: this.excludedFields,
            deleteOldData: this.config.deleteOldData || this.deleteOldData || false
        };
    }
}

module.exports = {
    ObjectConfig
};