#!/usr/bin/env node

require('dotenv').config({ override: true });

const { program } = require('commander');

const { DataManager } = require('./src/dataManager');
const { Config } = require('./config/config');

const { OPERATIONS, DEFAULT_TIMEOUT, LOG_LEVELS } = require('./config/constants');

async function main() {
    program
        .description('Export/import Salesforce data using SFDMU')
        .argument('[operation]', `Operation (${Object.values(OPERATIONS).join(', ')})`, OPERATIONS.HELP)
        .option('-s, --source <source>', 'Source org alias or username', process.env.SOURCE_ALIAS ?? '')
        .option('-t, --target <target>', 'Target org alias or username', process.env.TARGET_ALIAS ?? '')
        .option(
            '--source-orgs <sourceOrgs>',
            'Comma separated Sales Organization codes. If not provided, all available sales organizations will be processed automatically.',
            process.env.SOURCE_SALES_ORGS ?? ''
        )
        .option(
            '--target-orgs <targetOrgs>',
            'Maps import into specific sales orgs. Amount must match source sales orgs. If not provided, the source sales orgs will be used (or all orgs).',
            process.env.TARGET_SALES_ORGS ?? ''
        )
        .option('-v, --verbose', 'Activates verbose logging for the SFDMU tool')
        .option('--slim', 'Only import objects marked as slim in the config.')
        .option('-d, --delete', 'Delete old data.')
        .option('--simulation', 'No data will be transferred, but the tool will show the list of objects and fields that will be processed.')
        .option('--all-or-none', 'Setting this property to true will prevent partial updates.')
        .option('--timeout <timeout>', 'Timeout for SFDMU operations in seconds.', DEFAULT_TIMEOUT)
        .option('--log-level <logLevel>', 'Timeout for SFDMU operations in seconds.', LOG_LEVELS.ERROR)
        .option('--version-info', 'Show SFDMU version information')
        .option('-h, --help', 'Displays help for the command')
        .action(async (operation, options) => {
            try {
                if (operation === OPERATIONS.HELP || options.help) {
                    console.log(program.helpInformation());
                    process.exit(0);
                }

                // Show version info if requested
                if (options.versionInfo) {
                    console.log('\n📋 SF Data Manager v1.0.0');
                    const sfdmuVersion = await this.sfdmuManager.getVersion();
                    console.log(`🔧 SFDMU Plugin: ${sfdmuVersion}`);
                    console.log('');
                }

                const config = new Config(operation, options);

                const dataManager = new DataManager(config);

                await dataManager.init();
                await dataManager.processData();
            } catch (error) {
                console.error(`\n💥 Fatal Error: ${error.message}`);
                if (options.verbose) {
                    console.error('\n📊 Stack trace:');
                    console.error(error.stack);
                }
                process.exit(1);
            }
        })
        .name('data')
        .description('SF Data Manager')
        .version('1.0.0');

    await program.parseAsync();
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

if (require.main === module) {
    main().catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
