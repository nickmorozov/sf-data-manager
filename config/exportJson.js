const { ObjectConfig } = require('./objectConfig');

class ExportJson {
    constructor(config) {
        this.promptOnIssuesInCSVFiles = false;
        this.promptOnMissingParentObjects = false;

        if (config.simulation) {
            this.simulationMode = true;
        }

        if (config.allOrNone) {
            this.promptOnIssuesInCSVFiles = true;
            this.promptOnMissingParentObjects = true;
            this.allOrNone = true;
        }

        let objectConfigs = config.allObjects;

        if (config.isList || !config.targetOrg) {
            objectConfigs = config.salesOrgObjects;
        } else if (config.slim) {
            objectConfigs = config.slimObjects;
        }

        this.objects = objectConfigs.map((objectConfig) => new ObjectConfig(config, objectConfig).init());
    }
}

module.exports = {
    ExportJson
};
