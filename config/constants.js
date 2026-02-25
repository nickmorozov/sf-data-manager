const DEFAULT_TIMEOUT = 300; // 5 minutes
const LINE_REPEAT = 100;
const CSV_EXTENSION = '.csv';
const PARENT_IDS_SLUG = '${PARENT_IDS}';
const SALES_ORGS_SLUG = '${SALES_ORGS}';

const LOG_LEVELS = {
    TRACE: 'TRACE',
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
    FATAL: 'FATAL'
};

const OPERATIONS = {
    HELP: 'help',
    LIST: 'list',
    IMPORT: 'import',
    EXPORT: 'export'
};

module.exports = {
    DEFAULT_TIMEOUT,
    LOG_LEVELS,
    LINE_REPEAT,
    CSV_EXTENSION,
    OPERATIONS,
    PARENT_IDS_SLUG,
    SALES_ORGS_SLUG
};
