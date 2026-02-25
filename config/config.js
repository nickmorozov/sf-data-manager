const { ExportJson } = require('./exportJson');
const { OPERATIONS, LOG_LEVELS } = require('./constants');
const { loadProjectConfig } = require('../src/configLoader');
const path = require('path');
const fs = require('fs-extra');

const CSV_FILE = 'csvfile';

class Config {
    constructor(operation, options) {
        this.operation = operation;
        this.needTemporaryImport = false;
        this.madeTemporaryImport = false;

        // Load project config from YAML
        const projectRoot = process.cwd();
        const projectConfig = loadProjectConfig(projectRoot);

        this._objects = projectConfig.objects;
        this._salesOrgObject = projectConfig.salesOrgObject;
        this.hasSalesOrgs = !!projectConfig.salesOrgObject;

        const sourceOrgs =
            options.sourceOrgs
                ?.split(',')
                .map((org) => org.trim())
                .filter(Boolean) ?? []; // Allow empty array - will fetch all available sales orgs automatically
        const targetOrgs =
            options.targetOrgs
                ?.split(',')
                .map((org) => org.trim())
                .filter(Boolean) ?? sourceOrgs;

        if (targetOrgs.length > 0 && targetOrgs.length !== sourceOrgs.length && this.operation !== OPERATIONS.EXPORT) {
            throw new Error('The number of target sales orgs must match the number of source sales orgs.');
        }

        if (!Object.values(OPERATIONS).includes(this.operation)) {
            throw new Error('Invalid operation.');
        }

        this.source = this.isImport ? CSV_FILE : options.source;

        if (!this.isImport && this.source === CSV_FILE) {
            throw new Error('Source org is required.');
        }

        this.target = this.isImport ? options.target : CSV_FILE;

        if (this.isImport && this.target === CSV_FILE) {
            throw new Error('Target org is required.');
        }

        this.salesOrgs = sourceOrgs.map((org, index) => ({
            source: org,
            target: targetOrgs[index] || org // If no target is provided, use the source org
        }));

        this.slim = options.slim || false;

        if (!this.isImport && this.slim) {
            throw new Error('Slim option is only available for import operation.');
        }

        this.deleteOldData = options.delete || false;
        this.verbose = options.verbose || false;
        this.simulation = options.simulation || false;
        this.allOrNone = options.allOrNone || false;
        this.timeout = options.timeout * 1000;
        this.logLevel = options.verbose ? LOG_LEVELS.TRACE : options.logLevel;

        this.dataDir = path.resolve(projectRoot, projectConfig.dataDir);
        this.tmpDir = path.resolve(projectRoot, projectConfig.tmpDir);

        fs.ensureDir(this.dataDir).then();

        // Remove TMP_DIR if it exists
        if (fs.pathExists(this.tmpDir)) {
            fs.remove(this.tmpDir);
        }

        fs.ensureDir(this.tmpDir);

        this._exportJson = new ExportJson(this);
    }

    get exportJson() {
        return this._exportJson;
    }

    resetExportJson() {
        this._exportJson = new ExportJson(this);
    }

    get isExport() {
        return this.operation === OPERATIONS.EXPORT;
    }

    get isImport() {
        return this.operation === OPERATIONS.IMPORT;
    }

    get isList() {
        return this.operation === OPERATIONS.LIST;
    }

    get allObjects() {
        if (this.hasSalesOrgs) {
            return [this._salesOrgObject, ...this._objects];
        }
        return this._objects;
    }

    get salesOrgObjects() {
        return this._salesOrgObject ? [this._salesOrgObject] : [];
    }

    get slimObjects() {
        return this._objects.filter((obj) => obj.slim);
    }

    get junctionObjects() {
        return this._objects.filter((obj) => obj.junction);
    }

    get hierarchyObjects() {
        return this._objects.filter((obj) => obj.hierarchy);
    }

    getObject(name) {
        if (this._salesOrgObject && this._salesOrgObject.objectName === name) {
            return this._salesOrgObject;
        }
        return this._objects.find((obj) => obj.objectName === name);
    }
}

module.exports = {
    Config
};