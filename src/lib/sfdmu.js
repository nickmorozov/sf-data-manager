const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);

const SFDMU_PLUGIN_NAME = 'sfdmu';

class SfdmuManager {
    constructor(config) {
        this.config = config;
    }

    /**
     * Check if SFDMU plugin is installed
     * @returns {Promise<boolean>} True if plugin is installed
     * @throws {Error} If plugin is not installed or check fails
     */
    async checkPlugin() {
        try {
            console.log('Checking SFDMU plugin installation...');

            const { stdout, stderr } = await execAsync('sf plugins', {
                timeout: this.config.timeout,
            });

            if (stderr) {
                console.warn(`Warning during plugin check: ${stderr}`);
            }

            const isInstalled = stdout.toLowerCase().includes(SFDMU_PLUGIN_NAME);

            if (!isInstalled) {
                throw new Error(
                    `SFDMU plugin is not installed.\n` +
                        `Please install it with: sf plugins install ${SFDMU_PLUGIN_NAME}\n` +
                        `Or visit: https://github.com/forcedotcom/SFDX-Data-Move-Utility`
                );
            }

            console.log('✓ SFDMU plugin is installed');
            return true;
        } catch (error) {
            if (error.code === 'ETIMEDOUT') {
                throw new Error('Timeout while checking for SFDMU plugin. Please check your Salesforce CLI installation.');
            }

            if (error.message.includes('SFDMU plugin is not installed')) {
                throw error;
            }

            throw new Error(`Failed to check SFDMU plugin: ${error.message}`);
        }
    }

    /**
     * Build SFDMU command with proper argument handling
     * @returns {string} Complete command string
     * @param dataPath
     */
    buildCommand(dataPath) {
        if (!dataPath) {
            throw new Error('Data path is required');
        }

        return [
            'sf sfdmu run',
            `--loglevel ${this.config.logLevel}`,
            `--path "${path.resolve(dataPath)}"`,
            `--sourceusername "${this.config.source}"`,
            `--targetusername "${this.config.target}"`,
            '--logfullquery',
            this.config.verbose ? '--verbose' : '',
        ].join(' ');
    }

    /**
     * Execute SFDMU command with real-time output streaming
     * @returns {Promise<Object>} Execution result
     * @param dataPath
     */
    async executeCommand(dataPath) {
        const command = this.buildCommand(dataPath);

        console.log(`▶️ Executing SFDMU command: ${command}`);

        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            // Split command into parts for spawn
            const [cmd, ...args] = command.split(' ');

            const child = spawn(cmd, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: true,
            });

            if (this.config.verbose) {
                // Stream stdout in real-time
                child.stdout.on('data', (data) => {
                    process.stdout.write(data.toString());
                });

                // Stream stderr in real-time
                child.stderr.on('data', (data) => {
                    process.stderr.write(data.toString());
                });
            }

            // Handle process completion
            child.on('close', (code) => {
                const executionTime = (Date.now() - startTime) / 1000;

                if (code === 0) {
                    console.log(`\n✓ SFDMU execution completed in ${executionTime}s`);
                    resolve({
                        success: true,
                        exitCode: code,
                    });
                }
            });

            // Handle process errors
            child.on('error', (error) => {
                this.handleExecutionError(error, command);
            });

            // Handle timeout
            const timeoutId = setTimeout(() => {
                child.kill('SIGTERM');
                reject(new Error(`SFDMU execution timed out after ${this.config.timeout / 1000} seconds`));
            }, this.config.timeout);

            // Clear timeout on completion
            child.on('close', () => {
                clearTimeout(timeoutId);
            });
        });
    }

    /**
     * Handle execution errors with detailed error information
     * @param {Error} error - The error that occurred
     * @param {string} command - The command that failed
     * @returns {Object} Error result
     */
    handleExecutionError(error, command) {
        let errorMessage = 'SFDMU execution failed';

        if (error.code === 'ETIMEDOUT') {
            errorMessage = `SFDMU execution timed out after ${this.config.timeout / 1000} seconds`;
        } else if (error.signal === 'SIGTERM') {
            errorMessage = 'SFDMU execution was terminated';
        } else if (error.stderr) {
            errorMessage = `SFDMU execution failed: ${error.stderr}`;
        } else if (error.message) {
            errorMessage = `SFDMU execution failed: ${error.message}`;
        }

        // Log error details
        console.error(`✗ ${errorMessage}`);

        throw new Error(errorMessage);
    }

    /**
     * Run SFDMU operation with comprehensive error handling
     * @param {string} dataPath - Path to the data directory
     * @param config
     * @param {string} logLevel - Custom log level
     * @returns {Promise<Object>} Execution result
     */
    async run(dataPath) {
        try {
            // Execute the command
            return await this.executeCommand(dataPath);
        } catch (error) {
            console.error(`SFDMU operation failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get SFDMU version information
     * @returns {Promise<string>} Version information
     */
    async getVersion() {
        try {
            const { stdout } = await execAsync('sf plugins | grep sfdmu', { timeout: 5000 });
            return stdout.trim();
        } catch (error) {
            throw new Error(`Failed to get SFDMU version: ${error.message}`);
        }
    }
}

module.exports = {
    SfdmuManager,
};
