const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const { DATA_DIR, TMP_DIR } = require('./constants');

/**
 * Load and merge project configuration from all YAML files in the consumer project's config/ directory.
 * @param {string} projectRoot - Absolute path to the consumer project root
 * @returns {Object} Merged configuration with objects, salesOrg (or null), dataDir, tmpDir
 */
function loadProjectConfig(projectRoot) {
    const configDir = path.join(projectRoot, 'config');

    if (!fs.existsSync(configDir)) {
        throw new Error(`Config directory not found: ${configDir}`);
    }

    const files = fs.readdirSync(configDir);
    const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();

    if (yamlFiles.length === 0) {
        throw new Error(`No YAML config file found in ${configDir}`);
    }

    const configs = yamlFiles.map((f) => {
        const content = fs.readFileSync(path.join(configDir, f), 'utf8');
        const config = yaml.load(content);
        if (!config) {
            throw new Error(`Empty or invalid YAML file: ${f}`);
        }
        return { file: f, config };
    });

    // Merge: first file with each property wins; objects concatenate
    let name, dataDir, tmpDir, salesOrgObject;
    const allObjects = [];
    const seenObjectNames = new Map(); // objectName → source file

    for (const { file, config } of configs) {
        if (config.name && !name) name = config.name;
        else if (config.name && name && config.name !== name) {
            throw new Error(`Conflicting 'name' in ${file}: '${config.name}' vs '${name}'`);
        }

        if (config.dataDir && !dataDir) dataDir = config.dataDir;
        else if (config.dataDir && dataDir && config.dataDir !== dataDir) {
            throw new Error(`Conflicting 'dataDir' in ${file}: '${config.dataDir}' vs '${dataDir}'`);
        }

        if (config.tmpDir && !tmpDir) tmpDir = config.tmpDir;
        else if (config.tmpDir && tmpDir && config.tmpDir !== tmpDir) {
            throw new Error(`Conflicting 'tmpDir' in ${file}: '${config.tmpDir}' vs '${tmpDir}'`);
        }

        if (config.salesOrg && !salesOrgObject) salesOrgObject = config.salesOrg;
        else if (config.salesOrg && salesOrgObject) {
            throw new Error(`Conflicting 'salesOrg' in ${file}: salesOrg already defined`);
        }

        if (config.objects) {
            for (const obj of config.objects) {
                if (seenObjectNames.has(obj.objectName)) {
                    throw new Error(`Duplicate objectName '${obj.objectName}' in ${file} (already defined in ${seenObjectNames.get(obj.objectName)})`);
                }
                seenObjectNames.set(obj.objectName, file);
                allObjects.push(obj);
            }
        }
    }

    if (allObjects.length === 0) {
        throw new Error(`No objects defined across YAML files: ${yamlFiles.join(', ')}`);
    }

    return {
        name: name || path.basename(yamlFiles[0], path.extname(yamlFiles[0])),
        dataDir: dataDir || DATA_DIR,
        tmpDir: tmpDir || TMP_DIR,
        salesOrgObject: salesOrgObject || null,
        objects: allObjects,
    };
}

module.exports = { loadProjectConfig };
