const path = require('path');
const { ObjectConfig } = require('./objectConfig');

const ADDON_BASE = path.resolve(__dirname, '../addons');

class ExportJson {
    constructor(config) {
        this.excludeIdsFromCSVFiles = true;
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

        if (config.isList || (config.hasSalesOrgs && !config.targetOrg)) {
            objectConfigs = config.salesOrgObjects;
        } else if (config.slim) {
            objectConfigs = config.slimObjects;
        }

        this.objects = objectConfigs.map((objectConfig) => new ObjectConfig(config, objectConfig).init());

        // Add union resolver add-on at script level (export only)
        const unionArgs = this._buildUnionArgs(config);
        if (Object.keys(unionArgs.unions).length > 0 && config.isExport) {
            this.beforeAddons = [
                {
                    path: path.join(ADDON_BASE, 'union-resolver.mjs'),
                    description: 'Resolve union WHERE clauses',
                    excluded: false,
                    args: unionArgs,
                },
            ];
        }

        // Add hierarchy resolver add-on per-object (import only, non-simulation)
        if (config.isImport && !config.simulation) {
            for (const obj of this.objects) {
                const rawConfig = config.getObject(obj.objectName);
                if (!rawConfig?.hierarchy) continue;

                const hierarchies = Array.isArray(rawConfig.hierarchy) ? rawConfig.hierarchy : [rawConfig.hierarchy];
                obj.afterUpdateAddons = hierarchies.map((h) => ({
                    path: path.join(ADDON_BASE, 'hierarchy-resolver.mjs'),
                    description: `Resolve self-lookup hierarchy for ${obj.objectName}`,
                    excluded: false,
                    args: h,
                }));
            }
        }
    }

    _buildUnionArgs(config) {
        const unions = {};
        for (const objConfig of config.unionObjects) {
            const unionList = Array.isArray(objConfig.union) ? objConfig.union : [objConfig.union];
            unions[objConfig.objectName] = {
                externalId: objConfig.externalId,
                parents: unionList.map((u) => ({
                    objectName: u.parent.objectName,
                    field: u.parent.field,
                })),
                where: unionList[0].where,
            };
        }
        return { unions };
    }
}

module.exports = {
    ExportJson,
};
