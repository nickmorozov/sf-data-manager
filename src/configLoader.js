const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

/**
 * Load project configuration from a YAML file in the consumer project's config/ directory.
 * @param {string} projectRoot - Absolute path to the consumer project root (defaults to process.cwd())
 * @returns {Object} Parsed configuration with objects, salesOrg (or null), dataDir, tmpDir
 */
function loadProjectConfig(projectRoot) {
    const configDir = path.join(projectRoot, 'config');

    if (!fs.existsSync(configDir)) {
        throw new Error(`Config directory not found: ${configDir}`);
    }

    const files = fs.readdirSync(configDir);
    const yamlFile = files.find((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    if (!yamlFile) {
        throw new Error(`No YAML config file found in ${configDir}`);
    }

    const content = fs.readFileSync(path.join(configDir, yamlFile), 'utf8');
    const config = yaml.load(content);

    if (!config || !config.objects) {
        throw new Error(`Invalid config: 'objects' array is required in ${yamlFile}`);
    }

    return {
        name: config.name || path.basename(yamlFile, path.extname(yamlFile)),
        dataDir: config.dataDir || 'data',
        tmpDir: config.tmpDir || 'tmp',
        salesOrgObject: config.salesOrg || null,
        objects: config.objects
    };
}

module.exports = { loadProjectConfig };
