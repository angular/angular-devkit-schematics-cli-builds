#!/usr/bin/env node
"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = void 0;
// symbol polyfill must go first
require("symbol-observable");
const core_1 = require("@angular-devkit/core");
const node_1 = require("@angular-devkit/core/node");
const schematics_1 = require("@angular-devkit/schematics");
const tools_1 = require("@angular-devkit/schematics/tools");
const ansiColors = __importStar(require("ansi-colors"));
const inquirer = __importStar(require("inquirer"));
const yargs_parser_1 = __importStar(require("yargs-parser"));
/**
 * Parse the name of schematic passed in argument, and return a {collection, schematic} named
 * tuple. The user can pass in `collection-name:schematic-name`, and this function will either
 * return `{collection: 'collection-name', schematic: 'schematic-name'}`, or it will error out
 * and show usage.
 *
 * In the case where a collection name isn't part of the argument, the default is to use the
 * schematics package (@angular-devkit/schematics-cli) as the collection.
 *
 * This logic is entirely up to the tooling.
 *
 * @param str The argument to parse.
 * @return {{collection: string, schematic: (string)}}
 */
function parseSchematicName(str) {
    let collection = '@angular-devkit/schematics-cli';
    let schematic = str;
    if (schematic === null || schematic === void 0 ? void 0 : schematic.includes(':')) {
        const lastIndexOfColon = schematic.lastIndexOf(':');
        [collection, schematic] = [
            schematic.slice(0, lastIndexOfColon),
            schematic.substring(lastIndexOfColon + 1),
        ];
    }
    return { collection, schematic };
}
function _listSchematics(workflow, collectionName, logger) {
    try {
        const collection = workflow.engine.createCollection(collectionName);
        logger.info(collection.listSchematicNames().join('\n'));
    }
    catch (error) {
        logger.fatal(error.message);
        return 1;
    }
    return 0;
}
function _createPromptProvider() {
    return (definitions) => {
        const questions = definitions.map((definition) => {
            const question = {
                name: definition.id,
                message: definition.message,
                default: definition.default,
            };
            const validator = definition.validator;
            if (validator) {
                question.validate = (input) => validator(input);
            }
            switch (definition.type) {
                case 'confirmation':
                    return { ...question, type: 'confirm' };
                case 'list':
                    return {
                        ...question,
                        type: definition.multiselect ? 'checkbox' : 'list',
                        choices: definition.items &&
                            definition.items.map((item) => {
                                if (typeof item == 'string') {
                                    return item;
                                }
                                else {
                                    return {
                                        name: item.label,
                                        value: item.value,
                                    };
                                }
                            }),
                    };
                default:
                    return { ...question, type: definition.type };
            }
        });
        return inquirer.prompt(questions);
    };
}
// eslint-disable-next-line max-lines-per-function
async function main({ args, stdout = process.stdout, stderr = process.stderr, }) {
    const { cliOptions, schematicOptions, _ } = parseArgs(args);
    // Create a separate instance to prevent unintended global changes to the color configuration
    // Create function is not defined in the typings. See: https://github.com/doowb/ansi-colors/pull/44
    const colors = ansiColors.create();
    /** Create the DevKit Logger used through the CLI. */
    const logger = (0, node_1.createConsoleLogger)(!!cliOptions.verbose, stdout, stderr, {
        info: (s) => s,
        debug: (s) => s,
        warn: (s) => colors.bold.yellow(s),
        error: (s) => colors.bold.red(s),
        fatal: (s) => colors.bold.red(s),
    });
    if (cliOptions.help) {
        logger.info(getUsage());
        return 0;
    }
    /** Get the collection an schematic name from the first argument. */
    const { collection: collectionName, schematic: schematicName } = parseSchematicName(_.shift() || null);
    const isLocalCollection = collectionName.startsWith('.') || collectionName.startsWith('/');
    /** Gather the arguments for later use. */
    const debugPresent = cliOptions.debug !== null;
    const debug = debugPresent ? !!cliOptions.debug : isLocalCollection;
    const dryRunPresent = cliOptions['dry-run'] !== null;
    const dryRun = dryRunPresent ? !!cliOptions['dry-run'] : debug;
    const force = !!cliOptions.force;
    const allowPrivate = !!cliOptions['allow-private'];
    /** Create the workflow scoped to the working directory that will be executed with this run. */
    const workflow = new tools_1.NodeWorkflow(process.cwd(), {
        force,
        dryRun,
        resolvePaths: [process.cwd(), __dirname],
        schemaValidation: true,
    });
    /** If the user wants to list schematics, we simply show all the schematic names. */
    if (cliOptions['list-schematics']) {
        return _listSchematics(workflow, collectionName, logger);
    }
    if (!schematicName) {
        logger.info(getUsage());
        return 1;
    }
    if (debug) {
        logger.info(`Debug mode enabled${isLocalCollection ? ' by default for local collections' : ''}.`);
    }
    // Indicate to the user when nothing has been done. This is automatically set to off when there's
    // a new DryRunEvent.
    let nothingDone = true;
    // Logging queue that receives all the messages to show the users. This only get shown when no
    // errors happened.
    let loggingQueue = [];
    let error = false;
    /**
     * Logs out dry run events.
     *
     * All events will always be executed here, in order of discovery. That means that an error would
     * be shown along other events when it happens. Since errors in workflows will stop the Observable
     * from completing successfully, we record any events other than errors, then on completion we
     * show them.
     *
     * This is a simple way to only show errors when an error occur.
     */
    workflow.reporter.subscribe((event) => {
        nothingDone = false;
        // Strip leading slash to prevent confusion.
        const eventPath = event.path.startsWith('/') ? event.path.substr(1) : event.path;
        switch (event.kind) {
            case 'error':
                error = true;
                const desc = event.description == 'alreadyExist' ? 'already exists' : 'does not exist';
                logger.error(`ERROR! ${eventPath} ${desc}.`);
                break;
            case 'update':
                loggingQueue.push(`${colors.cyan('UPDATE')} ${eventPath} (${event.content.length} bytes)`);
                break;
            case 'create':
                loggingQueue.push(`${colors.green('CREATE')} ${eventPath} (${event.content.length} bytes)`);
                break;
            case 'delete':
                loggingQueue.push(`${colors.yellow('DELETE')} ${eventPath}`);
                break;
            case 'rename':
                const eventToPath = event.to.startsWith('/') ? event.to.substr(1) : event.to;
                loggingQueue.push(`${colors.blue('RENAME')} ${eventPath} => ${eventToPath}`);
                break;
        }
    });
    /**
     * Listen to lifecycle events of the workflow to flush the logs between each phases.
     */
    workflow.lifeCycle.subscribe((event) => {
        if (event.kind == 'workflow-end' || event.kind == 'post-tasks-start') {
            if (!error) {
                // Flush the log queue and clean the error state.
                loggingQueue.forEach((log) => logger.info(log));
            }
            loggingQueue = [];
            error = false;
        }
    });
    // Show usage of deprecated options
    workflow.registry.useXDeprecatedProvider((msg) => logger.warn(msg));
    // Pass the rest of the arguments as the smart default "argv". Then delete it.
    workflow.registry.addSmartDefaultProvider('argv', (schema) => 'index' in schema ? _[Number(schema['index'])] : _);
    // Add prompts.
    if (cliOptions.interactive && isTTY()) {
        workflow.registry.usePromptProvider(_createPromptProvider());
    }
    /**
     *  Execute the workflow, which will report the dry run events, run the tasks, and complete
     *  after all is done.
     *
     *  The Observable returned will properly cancel the workflow if unsubscribed, error out if ANY
     *  step of the workflow failed (sink or task), with details included, and will only complete
     *  when everything is done.
     */
    try {
        await workflow
            .execute({
            collection: collectionName,
            schematic: schematicName,
            options: schematicOptions,
            allowPrivate: allowPrivate,
            debug: debug,
            logger: logger,
        })
            .toPromise();
        if (nothingDone) {
            logger.info('Nothing to be done.');
        }
        else if (dryRun) {
            logger.info(`Dry run enabled${dryRunPresent ? '' : ' by default in debug mode'}. No files written to disk.`);
        }
        return 0;
    }
    catch (err) {
        if (err instanceof schematics_1.UnsuccessfulWorkflowExecution) {
            // "See above" because we already printed the error.
            logger.fatal('The Schematic workflow failed. See above.');
        }
        else if (debug) {
            logger.fatal(`An error occured:\n${err.stack}`);
        }
        else {
            logger.fatal(`Error: ${err.message}`);
        }
        return 1;
    }
}
exports.main = main;
/**
 * Get usage of the CLI tool.
 */
function getUsage() {
    return core_1.tags.stripIndent `
  schematics [collection-name:]schematic-name [options, ...]

  By default, if the collection name is not specified, use the internal collection provided
  by the Schematics CLI.

  Options:
      --debug             Debug mode. This is true by default if the collection is a relative
                          path (in that case, turn off with --debug=false).

      --allow-private     Allow private schematics to be run from the command line. Default to
                          false.

      --dry-run           Do not output anything, but instead just show what actions would be
                          performed. Default to true if debug is also true.

      --force             Force overwriting files that would otherwise be an error.

      --list-schematics   List all schematics from the collection, by name. A collection name
                          should be suffixed by a colon. Example: '@angular-devkit/schematics-cli:'.

      --no-interactive    Disables interactive input prompts.

      --verbose           Show more information.

      --help              Show this message.

  Any additional option is passed to the Schematics depending on its schema.
  `;
}
/** Parse the command line. */
const booleanArgs = [
    'allow-private',
    'debug',
    'dry-run',
    'force',
    'help',
    'list-schematics',
    'verbose',
    'interactive',
];
/** Parse the command line. */
function parseArgs(args) {
    const { _, ...options } = (0, yargs_parser_1.default)(args, {
        boolean: booleanArgs,
        default: {
            'interactive': true,
            'debug': null,
            'dry-run': null,
        },
        configuration: {
            'dot-notation': false,
            'boolean-negation': true,
            'strip-aliased': true,
            'camel-case-expansion': false,
        },
    });
    // Camelize options as yargs will return the object in kebab-case when camel casing is disabled.
    const schematicOptions = {};
    const cliOptions = {};
    const isCliOptions = (key) => booleanArgs.includes(key);
    for (const [key, value] of Object.entries(options)) {
        if (/[A-Z]/.test(key)) {
            throw new Error(`Unknown argument ${key}. Did you mean ${(0, yargs_parser_1.decamelize)(key)}?`);
        }
        if (isCliOptions(key)) {
            cliOptions[key] = value;
        }
        else {
            schematicOptions[(0, yargs_parser_1.camelCase)(key)] = value;
        }
    }
    return {
        _: _.map((v) => v.toString()),
        schematicOptions,
        cliOptions,
    };
}
function isTTY() {
    const isTruthy = (value) => {
        // Returns true if value is a string that is anything but 0 or false.
        return value !== undefined && value !== '0' && value.toUpperCase() !== 'FALSE';
    };
    // If we force TTY, we always return true.
    const force = process.env['NG_FORCE_TTY'];
    if (force !== undefined) {
        return isTruthy(force);
    }
    return !!process.stdout.isTTY && !isTruthy(process.env['CI']);
}
if (require.main === module) {
    const args = process.argv.slice(2);
    main({ args })
        .then((exitCode) => (process.exitCode = exitCode))
        .catch((e) => {
        throw e;
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2FuZ3VsYXJfZGV2a2l0L3NjaGVtYXRpY3NfY2xpL2Jpbi9zY2hlbWF0aWNzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0E7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsZ0NBQWdDO0FBQ2hDLDZCQUEyQjtBQUMzQiwrQ0FBNkQ7QUFDN0Qsb0RBQStFO0FBQy9FLDJEQUEyRTtBQUMzRSw0REFBZ0U7QUFDaEUsd0RBQTBDO0FBQzFDLG1EQUFxQztBQUNyQyw2REFBa0U7QUFFbEU7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILFNBQVMsa0JBQWtCLENBQUMsR0FBa0I7SUFDNUMsSUFBSSxVQUFVLEdBQUcsZ0NBQWdDLENBQUM7SUFFbEQsSUFBSSxTQUFTLEdBQUcsR0FBRyxDQUFDO0lBQ3BCLElBQUksU0FBUyxhQUFULFNBQVMsdUJBQVQsU0FBUyxDQUFFLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRTtRQUM1QixNQUFNLGdCQUFnQixHQUFHLFNBQVMsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDcEQsQ0FBQyxVQUFVLEVBQUUsU0FBUyxDQUFDLEdBQUc7WUFDeEIsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsZ0JBQWdCLENBQUM7WUFDcEMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxnQkFBZ0IsR0FBRyxDQUFDLENBQUM7U0FDMUMsQ0FBQztLQUNIO0lBRUQsT0FBTyxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsQ0FBQztBQUNuQyxDQUFDO0FBUUQsU0FBUyxlQUFlLENBQUMsUUFBc0IsRUFBRSxjQUFzQixFQUFFLE1BQXNCO0lBQzdGLElBQUk7UUFDRixNQUFNLFVBQVUsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQ3BFLE1BQU0sQ0FB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b250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG4vLyBzeW1ib2wgcG9seWZpbGwgbXVzdCBnbyBmaXJzdFxuaW1wb3J0ICdzeW1ib2wtb2JzZXJ2YWJsZSc7XG5pbXBvcnQgeyBsb2dnaW5nLCBzY2hlbWEsIHRhZ3MgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZSc7XG5pbXBvcnQgeyBQcm9jZXNzT3V0cHV0LCBjcmVhdGVDb25zb2xlTG9nZ2VyIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUvbm9kZSc7XG5pbXBvcnQgeyBVbnN1Y2Nlc3NmdWxXb3JrZmxvd0V4ZWN1dGlvbiB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzJztcbmltcG9ydCB7IE5vZGVXb3JrZmxvdyB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzL3Rvb2xzJztcbmltcG9ydCAqIGFzIGFuc2lDb2xvcnMgZnJvbSAnYW5zaS1jb2xvcnMnO1xuaW1wb3J0ICogYXMgaW5xdWlyZXIgZnJvbSAnaW5xdWlyZXInO1xuaW1wb3J0IHlhcmdzUGFyc2VyLCB7IGNhbWVsQ2FzZSwgZGVjYW1lbGl6ZSB9IGZyb20gJ3lhcmdzLXBhcnNlcic7XG5cbi8qKlxuICogUGFyc2UgdGhlIG5hbWUgb2Ygc2NoZW1hdGljIHBhc3NlZCBpbiBhcmd1bWVudCwgYW5kIHJldHVybiBhIHtjb2xsZWN0aW9uLCBzY2hlbWF0aWN9IG5hbWVkXG4gKiB0dXBsZS4gVGhlIHVzZXIgY2FuIHBhc3MgaW4gYGNvbGxlY3Rpb24tbmFtZTpzY2hlbWF0aWMtbmFtZWAsIGFuZCB0aGlzIGZ1bmN0aW9uIHdpbGwgZWl0aGVyXG4gKiByZXR1cm4gYHtjb2xsZWN0aW9uOiAnY29sbGVjdGlvbi1uYW1lJywgc2NoZW1hdGljOiAnc2NoZW1hdGljLW5hbWUnfWAsIG9yIGl0IHdpbGwgZXJyb3Igb3V0XG4gKiBhbmQgc2hvdyB1c2FnZS5cbiAqXG4gKiBJbiB0aGUgY2FzZSB3aGVyZSBhIGNvbGxlY3Rpb24gbmFtZSBpc24ndCBwYXJ0IG9mIHRoZSBhcmd1bWVudCwgdGhlIGRlZmF1bHQgaXMgdG8gdXNlIHRoZVxuICogc2NoZW1hdGljcyBwYWNrYWdlIChAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcy1jbGkpIGFzIHRoZSBjb2xsZWN0aW9uLlxuICpcbiAqIFRoaXMgbG9naWMgaXMgZW50aXJlbHkgdXAgdG8gdGhlIHRvb2xpbmcuXG4gKlxuICogQHBhcmFtIHN0ciBUaGUgYXJndW1lbnQgdG8gcGFyc2UuXG4gKiBAcmV0dXJuIHt7Y29sbGVjdGlvbjogc3RyaW5nLCBzY2hlbWF0aWM6IChzdHJpbmcpfX1cbiAqL1xuZnVuY3Rpb24gcGFyc2VTY2hlbWF0aWNOYW1lKHN0cjogc3RyaW5nIHwgbnVsbCk6IHsgY29sbGVjdGlvbjogc3RyaW5nOyBzY2hlbWF0aWM6IHN0cmluZyB8IG51bGwgfSB7XG4gIGxldCBjb2xsZWN0aW9uID0gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzLWNsaSc7XG5cbiAgbGV0IHNjaGVtYXRpYyA9IHN0cjtcbiAgaWYgKHNjaGVtYXRpYz8uaW5jbHVkZXMoJzonKSkge1xuICAgIGNvbnN0IGxhc3RJbmRleE9mQ29sb24gPSBzY2hlbWF0aWMubGFzdEluZGV4T2YoJzonKTtcbiAgICBbY29sbGVjdGlvbiwgc2NoZW1hdGljXSA9IFtcbiAgICAgIHNjaGVtYXRpYy5zbGljZSgwLCBsYXN0SW5kZXhPZkNvbG9uKSxcbiAgICAgIHNjaGVtYXRpYy5zdWJzdHJpbmcobGFzdEluZGV4T2ZDb2xvbiArIDEpLFxuICAgIF07XG4gIH1cblxuICByZXR1cm4geyBjb2xsZWN0aW9uLCBzY2hlbWF0aWMgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBNYWluT3B0aW9ucyB7XG4gIGFyZ3M6IHN0cmluZ1tdO1xuICBzdGRvdXQ/OiBQcm9jZXNzT3V0cHV0O1xuICBzdGRlcnI/OiBQcm9jZXNzT3V0cHV0O1xufVxuXG5mdW5jdGlvbiBfbGlzdFNjaGVtYXRpY3Mod29ya2Zsb3c6IE5vZGVXb3JrZmxvdywgY29sbGVjdGlvbk5hbWU6IHN0cmluZywgbG9nZ2VyOiBsb2dnaW5nLkxvZ2dlcikge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbGxlY3Rpb24gPSB3b3JrZmxvdy5lbmdpbmUuY3JlYXRlQ29sbGVjdGlvbihjb2xsZWN0aW9uTmFtZSk7XG4gICAgbG9nZ2VyLmluZm8oY29sbGVjdGlvbi5saXN0U2NoZW1hdGljTmFtZXMoKS5qb2luKCdcXG4nKSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgbG9nZ2VyLmZhdGFsKGVycm9yLm1lc3NhZ2UpO1xuXG4gICAgcmV0dXJuIDE7XG4gIH1cblxuICByZXR1cm4gMDtcbn1cblxuZnVuY3Rpb24gX2NyZWF0ZVByb21wdFByb3ZpZGVyKCk6IHNjaGVtYS5Qcm9tcHRQcm92aWRlciB7XG4gIHJldHVybiAoZGVmaW5pdGlvbnMpID0+IHtcbiAgICBjb25zdCBxdWVzdGlvbnM6IGlucXVpcmVyLlF1ZXN0aW9uQ29sbGVjdGlvbiA9IGRlZmluaXRpb25zLm1hcCgoZGVmaW5pdGlvbikgPT4ge1xuICAgICAgY29uc3QgcXVlc3Rpb246IGlucXVpcmVyLlF1ZXN0aW9uID0ge1xuICAgICAgICBuYW1lOiBkZWZpbml0aW9uLmlkLFxuICAgICAgICBtZXNzYWdlOiBkZWZpbml0aW9uLm1lc3NhZ2UsXG4gICAgICAgIGRlZmF1bHQ6IGRlZmluaXRpb24uZGVmYXVsdCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHZhbGlkYXRvciA9IGRlZmluaXRpb24udmFsaWRhdG9yO1xuICAgICAgaWYgKHZhbGlkYXRvcikge1xuICAgICAgICBxdWVzdGlvbi52YWxpZGF0ZSA9IChpbnB1dCkgPT4gdmFsaWRhdG9yKGlucHV0KTtcbiAgICAgIH1cblxuICAgICAgc3dpdGNoIChkZWZpbml0aW9uLnR5cGUpIHtcbiAgICAgICAgY2FzZSAnY29uZmlybWF0aW9uJzpcbiAgICAgICAgICByZXR1cm4geyAuLi5xdWVzdGlvbiwgdHlwZTogJ2NvbmZpcm0nIH07XG4gICAgICAgIGNhc2UgJ2xpc3QnOlxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5xdWVzdGlvbixcbiAgICAgICAgICAgIHR5cGU6IGRlZmluaXRpb24ubXVsdGlzZWxlY3QgPyAnY2hlY2tib3gnIDogJ2xpc3QnLFxuICAgICAgICAgICAgY2hvaWNlczpcbiAgICAgICAgICAgICAgZGVmaW5pdGlvbi5pdGVtcyAmJlxuICAgICAgICAgICAgICBkZWZpbml0aW9uLml0ZW1zLm1hcCgoaXRlbSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgaXRlbSA9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIGl0ZW07XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGl0ZW0ubGFiZWwsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBpdGVtLnZhbHVlLFxuICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgIH07XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgcmV0dXJuIHsgLi4ucXVlc3Rpb24sIHR5cGU6IGRlZmluaXRpb24udHlwZSB9O1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGlucXVpcmVyLnByb21wdChxdWVzdGlvbnMpO1xuICB9O1xufVxuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbWF4LWxpbmVzLXBlci1mdW5jdGlvblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1haW4oe1xuICBhcmdzLFxuICBzdGRvdXQgPSBwcm9jZXNzLnN0ZG91dCxcbiAgc3RkZXJyID0gcHJvY2Vzcy5zdGRlcnIsXG59OiBNYWluT3B0aW9ucyk6IFByb21pc2U8MCB8IDE+IHtcbiAgY29uc3QgeyBjbGlPcHRpb25zLCBzY2hlbWF0aWNPcHRpb25zLCBfIH0gPSBwYXJzZUFyZ3MoYXJncyk7XG5cbiAgLy8gQ3JlYXRlIGEgc2VwYXJhdGUgaW5zdGFuY2UgdG8gcHJldmVudCB1bmludGVuZGVkIGdsb2JhbCBjaGFuZ2VzIHRvIHRoZSBjb2xvciBjb25maWd1cmF0aW9uXG4gIC8vIENyZWF0ZSBmdW5jdGlvbiBpcyBub3QgZGVmaW5lZCBpbiB0aGUgdHlwaW5ncy4gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vZG9vd2IvYW5zaS1jb2xvcnMvcHVsbC80NFxuICBjb25zdCBjb2xvcnMgPSAoYW5zaUNvbG9ycyBhcyB0eXBlb2YgYW5zaUNvbG9ycyAmIHsgY3JlYXRlOiAoKSA9PiB0eXBlb2YgYW5zaUNvbG9ycyB9KS5jcmVhdGUoKTtcblxuICAvKiogQ3JlYXRlIHRoZSBEZXZLaXQgTG9nZ2VyIHVzZWQgdGhyb3VnaCB0aGUgQ0xJLiAqL1xuICBjb25zdCBsb2dnZXIgPSBjcmVhdGVDb25zb2xlTG9nZ2VyKCEhY2xpT3B0aW9ucy52ZXJib3NlLCBzdGRvdXQsIHN0ZGVyciwge1xuICAgIGluZm86IChzKSA9PiBzLFxuICAgIGRlYnVnOiAocykgPT4gcyxcbiAgICB3YXJuOiAocykgPT4gY29sb3JzLmJvbGQueWVsbG93KHMpLFxuICAgIGVycm9yOiAocykgPT4gY29sb3JzLmJvbGQucmVkKHMpLFxuICAgIGZhdGFsOiAocykgPT4gY29sb3JzLmJvbGQucmVkKHMpLFxuICB9KTtcblxuICBpZiAoY2xpT3B0aW9ucy5oZWxwKSB7XG4gICAgbG9nZ2VyLmluZm8oZ2V0VXNhZ2UoKSk7XG5cbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIC8qKiBHZXQgdGhlIGNvbGxlY3Rpb24gYW4gc2NoZW1hdGljIG5hbWUgZnJvbSB0aGUgZmlyc3QgYXJndW1lbnQuICovXG4gIGNvbnN0IHsgY29sbGVjdGlvbjogY29sbGVjdGlvbk5hbWUsIHNjaGVtYXRpYzogc2NoZW1hdGljTmFtZSB9ID0gcGFyc2VTY2hlbWF0aWNOYW1lKFxuICAgIF8uc2hpZnQoKSB8fCBudWxsLFxuICApO1xuXG4gIGNvbnN0IGlzTG9jYWxDb2xsZWN0aW9uID0gY29sbGVjdGlvbk5hbWUuc3RhcnRzV2l0aCgnLicpIHx8IGNvbGxlY3Rpb25OYW1lLnN0YXJ0c1dpdGgoJy8nKTtcblxuICAvKiogR2F0aGVyIHRoZSBhcmd1bWVudHMgZm9yIGxhdGVyIHVzZS4gKi9cbiAgY29uc3QgZGVidWdQcmVzZW50ID0gY2xpT3B0aW9ucy5kZWJ1ZyAhPT0gbnVsbDtcbiAgY29uc3QgZGVidWcgPSBkZWJ1Z1ByZXNlbnQgPyAhIWNsaU9wdGlvbnMuZGVidWcgOiBpc0xvY2FsQ29sbGVjdGlvbjtcbiAgY29uc3QgZHJ5UnVuUHJlc2VudCA9IGNsaU9wdGlvbnNbJ2RyeS1ydW4nXSAhPT0gbnVsbDtcbiAgY29uc3QgZHJ5UnVuID0gZHJ5UnVuUHJlc2VudCA/ICEhY2xpT3B0aW9uc1snZHJ5LXJ1biddIDogZGVidWc7XG4gIGNvbnN0IGZvcmNlID0gISFjbGlPcHRpb25zLmZvcmNlO1xuICBjb25zdCBhbGxvd1ByaXZhdGUgPSAhIWNsaU9wdGlvbnNbJ2FsbG93LXByaXZhdGUnXTtcblxuICAvKiogQ3JlYXRlIHRoZSB3b3JrZmxvdyBzY29wZWQgdG8gdGhlIHdvcmtpbmcgZGlyZWN0b3J5IHRoYXQgd2lsbCBiZSBleGVjdXRlZCB3aXRoIHRoaXMgcnVuLiAqL1xuICBjb25zdCB3b3JrZmxvdyA9IG5ldyBOb2RlV29ya2Zsb3cocHJvY2Vzcy5jd2QoKSwge1xuICAgIGZvcmNlLFxuICAgIGRyeVJ1bixcbiAgICByZXNvbHZlUGF0aHM6IFtwcm9jZXNzLmN3ZCgpLCBfX2Rpcm5hbWVdLFxuICAgIHNjaGVtYVZhbGlkYXRpb246IHRydWUsXG4gIH0pO1xuXG4gIC8qKiBJZiB0aGUgdXNlciB3YW50cyB0byBsaXN0IHNjaGVtYXRpY3MsIHdlIHNpbXBseSBzaG93IGFsbCB0aGUgc2NoZW1hdGljIG5hbWVzLiAqL1xuICBpZiAoY2xpT3B0aW9uc1snbGlzdC1zY2hlbWF0aWNzJ10pIHtcbiAgICByZXR1cm4gX2xpc3RTY2hlbWF0aWNzKHdvcmtmbG93LCBjb2xsZWN0aW9uTmFtZSwgbG9nZ2VyKTtcbiAgfVxuXG4gIGlmICghc2NoZW1hdGljTmFtZSkge1xuICAgIGxvZ2dlci5pbmZvKGdldFVzYWdlKCkpO1xuXG4gICAgcmV0dXJuIDE7XG4gIH1cblxuICBpZiAoZGVidWcpIHtcbiAgICBsb2dnZXIuaW5mbyhcbiAgICAgIGBEZWJ1ZyBtb2RlIGVuYWJsZWQke2lzTG9jYWxDb2xsZWN0aW9uID8gJyBieSBkZWZhdWx0IGZvciBsb2NhbCBjb2xsZWN0aW9ucycgOiAnJ30uYCxcbiAgICApO1xuICB9XG5cbiAgLy8gSW5kaWNhdGUgdG8gdGhlIHVzZXIgd2hlbiBub3RoaW5nIGhhcyBiZWVuIGRvbmUuIFRoaXMgaXMgYXV0b21hdGljYWxseSBzZXQgdG8gb2ZmIHdoZW4gdGhlcmUnc1xuICAvLyBhIG5ldyBEcnlSdW5FdmVudC5cbiAgbGV0IG5vdGhpbmdEb25lID0gdHJ1ZTtcblxuICAvLyBMb2dnaW5nIHF1ZXVlIHRoYXQgcmVjZWl2ZXMgYWxsIHRoZSBtZXNzYWdlcyB0byBzaG93IHRoZSB1c2Vycy4gVGhpcyBvbmx5IGdldCBzaG93biB3aGVuIG5vXG4gIC8vIGVycm9ycyBoYXBwZW5lZC5cbiAgbGV0IGxvZ2dpbmdRdWV1ZTogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGVycm9yID0gZmFsc2U7XG5cbiAgLyoqXG4gICAqIExvZ3Mgb3V0IGRyeSBydW4gZXZlbnRzLlxuICAgKlxuICAgKiBBbGwgZXZlbnRzIHdpbGwgYWx3YXlzIGJlIGV4ZWN1dGVkIGhlcmUsIGluIG9yZGVyIG9mIGRpc2NvdmVyeS4gVGhhdCBtZWFucyB0aGF0IGFuIGVycm9yIHdvdWxkXG4gICAqIGJlIHNob3duIGFsb25nIG90aGVyIGV2ZW50cyB3aGVuIGl0IGhhcHBlbnMuIFNpbmNlIGVycm9ycyBpbiB3b3JrZmxvd3Mgd2lsbCBzdG9wIHRoZSBPYnNlcnZhYmxlXG4gICAqIGZyb20gY29tcGxldGluZyBzdWNjZXNzZnVsbHksIHdlIHJlY29yZCBhbnkgZXZlbnRzIG90aGVyIHRoYW4gZXJyb3JzLCB0aGVuIG9uIGNvbXBsZXRpb24gd2VcbiAgICogc2hvdyB0aGVtLlxuICAgKlxuICAgKiBUaGlzIGlzIGEgc2ltcGxlIHdheSB0byBvbmx5IHNob3cgZXJyb3JzIHdoZW4gYW4gZXJyb3Igb2NjdXIuXG4gICAqL1xuICB3b3JrZmxvdy5yZXBvcnRlci5zdWJzY3JpYmUoKGV2ZW50KSA9PiB7XG4gICAgbm90aGluZ0RvbmUgPSBmYWxzZTtcbiAgICAvLyBTdHJpcCBsZWFkaW5nIHNsYXNoIHRvIHByZXZlbnQgY29uZnVzaW9uLlxuICAgIGNvbnN0IGV2ZW50UGF0aCA9IGV2ZW50LnBhdGguc3RhcnRzV2l0aCgnLycpID8gZXZlbnQucGF0aC5zdWJzdHIoMSkgOiBldmVudC5wYXRoO1xuXG4gICAgc3dpdGNoIChldmVudC5raW5kKSB7XG4gICAgICBjYXNlICdlcnJvcic6XG4gICAgICAgIGVycm9yID0gdHJ1ZTtcblxuICAgICAgICBjb25zdCBkZXNjID0gZXZlbnQuZGVzY3JpcHRpb24gPT0gJ2FscmVhZHlFeGlzdCcgPyAnYWxyZWFkeSBleGlzdHMnIDogJ2RvZXMgbm90IGV4aXN0JztcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBFUlJPUiEgJHtldmVudFBhdGh9ICR7ZGVzY30uYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndXBkYXRlJzpcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7Y29sb3JzLmN5YW4oJ1VQREFURScpfSAke2V2ZW50UGF0aH0gKCR7ZXZlbnQuY29udGVudC5sZW5ndGh9IGJ5dGVzKWApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke2NvbG9ycy5ncmVlbignQ1JFQVRFJyl9ICR7ZXZlbnRQYXRofSAoJHtldmVudC5jb250ZW50Lmxlbmd0aH0gYnl0ZXMpYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7Y29sb3JzLnllbGxvdygnREVMRVRFJyl9ICR7ZXZlbnRQYXRofWApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3JlbmFtZSc6XG4gICAgICAgIGNvbnN0IGV2ZW50VG9QYXRoID0gZXZlbnQudG8uc3RhcnRzV2l0aCgnLycpID8gZXZlbnQudG8uc3Vic3RyKDEpIDogZXZlbnQudG87XG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke2NvbG9ycy5ibHVlKCdSRU5BTUUnKX0gJHtldmVudFBhdGh9ID0+ICR7ZXZlbnRUb1BhdGh9YCk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfSk7XG5cbiAgLyoqXG4gICAqIExpc3RlbiB0byBsaWZlY3ljbGUgZXZlbnRzIG9mIHRoZSB3b3JrZmxvdyB0byBmbHVzaCB0aGUgbG9ncyBiZXR3ZWVuIGVhY2ggcGhhc2VzLlxuICAgKi9cbiAgd29ya2Zsb3cubGlmZUN5Y2xlLnN1YnNjcmliZSgoZXZlbnQpID0+IHtcbiAgICBpZiAoZXZlbnQua2luZCA9PSAnd29ya2Zsb3ctZW5kJyB8fCBldmVudC5raW5kID09ICdwb3N0LXRhc2tzLXN0YXJ0Jykge1xuICAgICAgaWYgKCFlcnJvcikge1xuICAgICAgICAvLyBGbHVzaCB0aGUgbG9nIHF1ZXVlIGFuZCBjbGVhbiB0aGUgZXJyb3Igc3RhdGUuXG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5mb3JFYWNoKChsb2cpID0+IGxvZ2dlci5pbmZvKGxvZykpO1xuICAgICAgfVxuXG4gICAgICBsb2dnaW5nUXVldWUgPSBbXTtcbiAgICAgIGVycm9yID0gZmFsc2U7XG4gICAgfVxuICB9KTtcblxuICAvLyBTaG93IHVzYWdlIG9mIGRlcHJlY2F0ZWQgb3B0aW9uc1xuICB3b3JrZmxvdy5yZWdpc3RyeS51c2VYRGVwcmVjYXRlZFByb3ZpZGVyKChtc2cpID0+IGxvZ2dlci53YXJuKG1zZykpO1xuXG4gIC8vIFBhc3MgdGhlIHJlc3Qgb2YgdGhlIGFyZ3VtZW50cyBhcyB0aGUgc21hcnQgZGVmYXVsdCBcImFyZ3ZcIi4gVGhlbiBkZWxldGUgaXQuXG4gIHdvcmtmbG93LnJlZ2lzdHJ5LmFkZFNtYXJ0RGVmYXVsdFByb3ZpZGVyKCdhcmd2JywgKHNjaGVtYSkgPT5cbiAgICAnaW5kZXgnIGluIHNjaGVtYSA/IF9bTnVtYmVyKHNjaGVtYVsnaW5kZXgnXSldIDogXyxcbiAgKTtcblxuICAvLyBBZGQgcHJvbXB0cy5cbiAgaWYgKGNsaU9wdGlvbnMuaW50ZXJhY3RpdmUgJiYgaXNUVFkoKSkge1xuICAgIHdvcmtmbG93LnJlZ2lzdHJ5LnVzZVByb21wdFByb3ZpZGVyKF9jcmVhdGVQcm9tcHRQcm92aWRlcigpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiAgRXhlY3V0ZSB0aGUgd29ya2Zsb3csIHdoaWNoIHdpbGwgcmVwb3J0IHRoZSBkcnkgcnVuIGV2ZW50cywgcnVuIHRoZSB0YXNrcywgYW5kIGNvbXBsZXRlXG4gICAqICBhZnRlciBhbGwgaXMgZG9uZS5cbiAgICpcbiAgICogIFRoZSBPYnNlcnZhYmxlIHJldHVybmVkIHdpbGwgcHJvcGVybHkgY2FuY2VsIHRoZSB3b3JrZmxvdyBpZiB1bnN1YnNjcmliZWQsIGVycm9yIG91dCBpZiBBTllcbiAgICogIHN0ZXAgb2YgdGhlIHdvcmtmbG93IGZhaWxlZCAoc2luayBvciB0YXNrKSwgd2l0aCBkZXRhaWxzIGluY2x1ZGVkLCBhbmQgd2lsbCBvbmx5IGNvbXBsZXRlXG4gICAqICB3aGVuIGV2ZXJ5dGhpbmcgaXMgZG9uZS5cbiAgICovXG4gIHRyeSB7XG4gICAgYXdhaXQgd29ya2Zsb3dcbiAgICAgIC5leGVjdXRlKHtcbiAgICAgICAgY29sbGVjdGlvbjogY29sbGVjdGlvbk5hbWUsXG4gICAgICAgIHNjaGVtYXRpYzogc2NoZW1hdGljTmFtZSxcbiAgICAgICAgb3B0aW9uczogc2NoZW1hdGljT3B0aW9ucyxcbiAgICAgICAgYWxsb3dQcml2YXRlOiBhbGxvd1ByaXZhdGUsXG4gICAgICAgIGRlYnVnOiBkZWJ1ZyxcbiAgICAgICAgbG9nZ2VyOiBsb2dnZXIsXG4gICAgICB9KVxuICAgICAgLnRvUHJvbWlzZSgpO1xuXG4gICAgaWYgKG5vdGhpbmdEb25lKSB7XG4gICAgICBsb2dnZXIuaW5mbygnTm90aGluZyB0byBiZSBkb25lLicpO1xuICAgIH0gZWxzZSBpZiAoZHJ5UnVuKSB7XG4gICAgICBsb2dnZXIuaW5mbyhcbiAgICAgICAgYERyeSBydW4gZW5hYmxlZCR7XG4gICAgICAgICAgZHJ5UnVuUHJlc2VudCA/ICcnIDogJyBieSBkZWZhdWx0IGluIGRlYnVnIG1vZGUnXG4gICAgICAgIH0uIE5vIGZpbGVzIHdyaXR0ZW4gdG8gZGlzay5gLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gMDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgaWYgKGVyciBpbnN0YW5jZW9mIFVuc3VjY2Vzc2Z1bFdvcmtmbG93RXhlY3V0aW9uKSB7XG4gICAgICAvLyBcIlNlZSBhYm92ZVwiIGJlY2F1c2Ugd2UgYWxyZWFkeSBwcmludGVkIHRoZSBlcnJvci5cbiAgICAgIGxvZ2dlci5mYXRhbCgnVGhlIFNjaGVtYXRpYyB3b3JrZmxvdyBmYWlsZWQuIFNlZSBhYm92ZS4nKTtcbiAgICB9IGVsc2UgaWYgKGRlYnVnKSB7XG4gICAgICBsb2dnZXIuZmF0YWwoYEFuIGVycm9yIG9jY3VyZWQ6XFxuJHtlcnIuc3RhY2t9YCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvZ2dlci5mYXRhbChgRXJyb3I6ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIDE7XG4gIH1cbn1cblxuLyoqXG4gKiBHZXQgdXNhZ2Ugb2YgdGhlIENMSSB0b29sLlxuICovXG5mdW5jdGlvbiBnZXRVc2FnZSgpOiBzdHJpbmcge1xuICByZXR1cm4gdGFncy5zdHJpcEluZGVudGBcbiAgc2NoZW1hdGljcyBbY29sbGVjdGlvbi1uYW1lOl1zY2hlbWF0aWMtbmFtZSBbb3B0aW9ucywgLi4uXVxuXG4gIEJ5IGRlZmF1bHQsIGlmIHRoZSBjb2xsZWN0aW9uIG5hbWUgaXMgbm90IHNwZWNpZmllZCwgdXNlIHRoZSBpbnRlcm5hbCBjb2xsZWN0aW9uIHByb3ZpZGVkXG4gIGJ5IHRoZSBTY2hlbWF0aWNzIENMSS5cblxuICBPcHRpb25zOlxuICAgICAgLS1kZWJ1ZyAgICAgICAgICAgICBEZWJ1ZyBtb2RlLiBUaGlzIGlzIHRydWUgYnkgZGVmYXVsdCBpZiB0aGUgY29sbGVjdGlvbiBpcyBhIHJlbGF0aXZlXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGggKGluIHRoYXQgY2FzZSwgdHVybiBvZmYgd2l0aCAtLWRlYnVnPWZhbHNlKS5cblxuICAgICAgLS1hbGxvdy1wcml2YXRlICAgICBBbGxvdyBwcml2YXRlIHNjaGVtYXRpY3MgdG8gYmUgcnVuIGZyb20gdGhlIGNvbW1hbmQgbGluZS4gRGVmYXVsdCB0b1xuICAgICAgICAgICAgICAgICAgICAgICAgICBmYWxzZS5cblxuICAgICAgLS1kcnktcnVuICAgICAgICAgICBEbyBub3Qgb3V0cHV0IGFueXRoaW5nLCBidXQgaW5zdGVhZCBqdXN0IHNob3cgd2hhdCBhY3Rpb25zIHdvdWxkIGJlXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHBlcmZvcm1lZC4gRGVmYXVsdCB0byB0cnVlIGlmIGRlYnVnIGlzIGFsc28gdHJ1ZS5cblxuICAgICAgLS1mb3JjZSAgICAgICAgICAgICBGb3JjZSBvdmVyd3JpdGluZyBmaWxlcyB0aGF0IHdvdWxkIG90aGVyd2lzZSBiZSBhbiBlcnJvci5cblxuICAgICAgLS1saXN0LXNjaGVtYXRpY3MgICBMaXN0IGFsbCBzY2hlbWF0aWNzIGZyb20gdGhlIGNvbGxlY3Rpb24sIGJ5IG5hbWUuIEEgY29sbGVjdGlvbiBuYW1lXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHNob3VsZCBiZSBzdWZmaXhlZCBieSBhIGNvbG9uLiBFeGFtcGxlOiAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MtY2xpOicuXG5cbiAgICAgIC0tbm8taW50ZXJhY3RpdmUgICAgRGlzYWJsZXMgaW50ZXJhY3RpdmUgaW5wdXQgcHJvbXB0cy5cblxuICAgICAgLS12ZXJib3NlICAgICAgICAgICBTaG93IG1vcmUgaW5mb3JtYXRpb24uXG5cbiAgICAgIC0taGVscCAgICAgICAgICAgICAgU2hvdyB0aGlzIG1lc3NhZ2UuXG5cbiAgQW55IGFkZGl0aW9uYWwgb3B0aW9uIGlzIHBhc3NlZCB0byB0aGUgU2NoZW1hdGljcyBkZXBlbmRpbmcgb24gaXRzIHNjaGVtYS5cbiAgYDtcbn1cblxuLyoqIFBhcnNlIHRoZSBjb21tYW5kIGxpbmUuICovXG5jb25zdCBib29sZWFuQXJncyA9IFtcbiAgJ2FsbG93LXByaXZhdGUnLFxuICAnZGVidWcnLFxuICAnZHJ5LXJ1bicsXG4gICdmb3JjZScsXG4gICdoZWxwJyxcbiAgJ2xpc3Qtc2NoZW1hdGljcycsXG4gICd2ZXJib3NlJyxcbiAgJ2ludGVyYWN0aXZlJyxcbl0gYXMgY29uc3Q7XG5cbnR5cGUgRWxlbWVudFR5cGU8VCBleHRlbmRzIFJlYWRvbmx5QXJyYXk8dW5rbm93bj4+ID0gVCBleHRlbmRzIFJlYWRvbmx5QXJyYXk8aW5mZXIgRWxlbWVudFR5cGU+XG4gID8gRWxlbWVudFR5cGVcbiAgOiBuZXZlcjtcblxuaW50ZXJmYWNlIE9wdGlvbnMge1xuICBfOiBzdHJpbmdbXTtcbiAgc2NoZW1hdGljT3B0aW9uczogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGNsaU9wdGlvbnM6IFBhcnRpYWw8UmVjb3JkPEVsZW1lbnRUeXBlPHR5cGVvZiBib29sZWFuQXJncz4sIGJvb2xlYW4gfCBudWxsPj47XG59XG5cbi8qKiBQYXJzZSB0aGUgY29tbWFuZCBsaW5lLiAqL1xuZnVuY3Rpb24gcGFyc2VBcmdzKGFyZ3M6IHN0cmluZ1tdKTogT3B0aW9ucyB7XG4gIGNvbnN0IHsgXywgLi4ub3B0aW9ucyB9ID0geWFyZ3NQYXJzZXIoYXJncywge1xuICAgIGJvb2xlYW46IGJvb2xlYW5BcmdzIGFzIHVua25vd24gYXMgc3RyaW5nW10sXG4gICAgZGVmYXVsdDoge1xuICAgICAgJ2ludGVyYWN0aXZlJzogdHJ1ZSxcbiAgICAgICdkZWJ1Zyc6IG51bGwsXG4gICAgICAnZHJ5LXJ1bic6IG51bGwsXG4gICAgfSxcbiAgICBjb25maWd1cmF0aW9uOiB7XG4gICAgICAnZG90LW5vdGF0aW9uJzogZmFsc2UsXG4gICAgICAnYm9vbGVhbi1uZWdhdGlvbic6IHRydWUsXG4gICAgICAnc3RyaXAtYWxpYXNlZCc6IHRydWUsXG4gICAgICAnY2FtZWwtY2FzZS1leHBhbnNpb24nOiBmYWxzZSxcbiAgICB9LFxuICB9KTtcblxuICAvLyBDYW1lbGl6ZSBvcHRpb25zIGFzIHlhcmdzIHdpbGwgcmV0dXJuIHRoZSBvYmplY3QgaW4ga2ViYWItY2FzZSB3aGVuIGNhbWVsIGNhc2luZyBpcyBkaXNhYmxlZC5cbiAgY29uc3Qgc2NoZW1hdGljT3B0aW9uczogT3B0aW9uc1snc2NoZW1hdGljT3B0aW9ucyddID0ge307XG4gIGNvbnN0IGNsaU9wdGlvbnM6IE9wdGlvbnNbJ2NsaU9wdGlvbnMnXSA9IHt9O1xuXG4gIGNvbnN0IGlzQ2xpT3B0aW9ucyA9IChcbiAgICBrZXk6IEVsZW1lbnRUeXBlPHR5cGVvZiBib29sZWFuQXJncz4gfCBzdHJpbmcsXG4gICk6IGtleSBpcyBFbGVtZW50VHlwZTx0eXBlb2YgYm9vbGVhbkFyZ3M+ID0+XG4gICAgYm9vbGVhbkFyZ3MuaW5jbHVkZXMoa2V5IGFzIEVsZW1lbnRUeXBlPHR5cGVvZiBib29sZWFuQXJncz4pO1xuXG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKG9wdGlvbnMpKSB7XG4gICAgaWYgKC9bQS1aXS8udGVzdChrZXkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gYXJndW1lbnQgJHtrZXl9LiBEaWQgeW91IG1lYW4gJHtkZWNhbWVsaXplKGtleSl9P2ApO1xuICAgIH1cblxuICAgIGlmIChpc0NsaU9wdGlvbnMoa2V5KSkge1xuICAgICAgY2xpT3B0aW9uc1trZXldID0gdmFsdWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIHNjaGVtYXRpY09wdGlvbnNbY2FtZWxDYXNlKGtleSldID0gdmFsdWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBfOiBfLm1hcCgodikgPT4gdi50b1N0cmluZygpKSxcbiAgICBzY2hlbWF0aWNPcHRpb25zLFxuICAgIGNsaU9wdGlvbnMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGlzVFRZKCk6IGJvb2xlYW4ge1xuICBjb25zdCBpc1RydXRoeSA9ICh2YWx1ZTogdW5kZWZpbmVkIHwgc3RyaW5nKSA9PiB7XG4gICAgLy8gUmV0dXJucyB0cnVlIGlmIHZhbHVlIGlzIGEgc3RyaW5nIHRoYXQgaXMgYW55dGhpbmcgYnV0IDAgb3IgZmFsc2UuXG4gICAgcmV0dXJuIHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09ICcwJyAmJiB2YWx1ZS50b1VwcGVyQ2FzZSgpICE9PSAnRkFMU0UnO1xuICB9O1xuXG4gIC8vIElmIHdlIGZvcmNlIFRUWSwgd2UgYWx3YXlzIHJldHVybiB0cnVlLlxuICBjb25zdCBmb3JjZSA9IHByb2Nlc3MuZW52WydOR19GT1JDRV9UVFknXTtcbiAgaWYgKGZvcmNlICE9PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gaXNUcnV0aHkoZm9yY2UpO1xuICB9XG5cbiAgcmV0dXJuICEhcHJvY2Vzcy5zdGRvdXQuaXNUVFkgJiYgIWlzVHJ1dGh5KHByb2Nlc3MuZW52WydDSSddKTtcbn1cblxuaWYgKHJlcXVpcmUubWFpbiA9PT0gbW9kdWxlKSB7XG4gIGNvbnN0IGFyZ3MgPSBwcm9jZXNzLmFyZ3Yuc2xpY2UoMik7XG4gIG1haW4oeyBhcmdzIH0pXG4gICAgLnRoZW4oKGV4aXRDb2RlKSA9PiAocHJvY2Vzcy5leGl0Q29kZSA9IGV4aXRDb2RlKSlcbiAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgIHRocm93IGU7XG4gICAgfSk7XG59XG4iXX0=