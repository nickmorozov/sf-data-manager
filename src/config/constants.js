const DEFAULT_TIMEOUT = 300; // 5 minutes
const LINE_REPEAT = 100;
const CSV_EXTENSION = '.csv';
const SALES_ORGS_SLUG = '${SALES_ORGS}';

const LOG_LEVELS = {
    TRACE: 'TRACE',
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
    FATAL: 'FATAL',
};

const OPERATIONS = {
    IMPORT: 'import',
    EXPORT: 'export',
};

module.exports = {
    DEFAULT_TIMEOUT,
    LOG_LEVELS,
    LINE_REPEAT,
    CSV_EXTENSION,
    OPERATIONS,
    SALES_ORGS_SLUG,
};
