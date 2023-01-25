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
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
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
const fs_1 = require("fs");
const inquirer = __importStar(require("inquirer"));
const path = __importStar(require("path"));
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
        logger.fatal(error instanceof Error ? error.message : `${error}`);
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
function findUp(names, from) {
    if (!Array.isArray(names)) {
        names = [names];
    }
    const root = path.parse(from).root;
    let currentDir = from;
    while (currentDir && currentDir !== root) {
        for (const name of names) {
            const p = path.join(currentDir, name);
            if ((0, fs_1.existsSync)(p)) {
                return p;
            }
        }
        currentDir = path.dirname(currentDir);
    }
    return null;
}
/**
 * return package manager' name by lock file
 */
function getPackageManagerName() {
    // order by check priority
    const LOCKS = {
        'package-lock.json': 'npm',
        'yarn.lock': 'yarn',
        'pnpm-lock.yaml': 'pnpm',
    };
    const lockPath = findUp(Object.keys(LOCKS), process.cwd());
    if (lockPath) {
        return LOCKS[path.basename(lockPath)];
    }
    return 'npm';
}
// eslint-disable-next-line max-lines-per-function
async function main({ args, stdout = process.stdout, stderr = process.stderr, }) {
    const { cliOptions, schematicOptions, _ } = parseArgs(args);
    // Create a separate instance to prevent unintended global changes to the color configuration
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
        packageManager: getPackageManagerName(),
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
        const eventPath = event.path.startsWith('/') ? event.path.slice(1) : event.path;
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
                const eventToPath = event.to.startsWith('/') ? event.to.slice(1) : event.to;
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
        else if (debug && err instanceof Error) {
            logger.fatal(`An error occured:\n${err.stack}`);
        }
        else {
            logger.fatal(`Error: ${err instanceof Error ? err.message : err}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2FuZ3VsYXJfZGV2a2l0L3NjaGVtYXRpY3NfY2xpL2Jpbi9zY2hlbWF0aWNzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0E7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILGdDQUFnQztBQUNoQyw2QkFBMkI7QUFDM0IsK0NBQTZEO0FBQzdELG9EQUErRTtBQUMvRSwyREFBMkU7QUFDM0UsNERBQWdFO0FBQ2hFLHdEQUEwQztBQUMxQywyQkFBZ0M7QUFDaEMsbURBQXFDO0FBQ3JDLDJDQUE2QjtBQUM3Qiw2REFBa0U7QUFFbEU7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILFNBQVMsa0JBQWtCLENBQUMsR0FBa0I7SUFDNUMsSUFBSSxVQUFVLEdBQUcsZ0NBQWdDLENBQUM7SUFFbEQsSUFBSSxTQUFTLEdBQUcsR0FBRyxDQUFDO0lBQ3BCLElBQUksU0FBUyxhQUFULFNBQVMsdUJBQVQsU0FBUyxDQUFFLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRTtRQUM1QixNQUFNLGdCQUFnQixHQUFHLFNBQVMsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDcEQsQ0FBQyxVQUFVLEVBQUUsU0FBUyxDQUFDLEdBQUc7WUFDeEIsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsZ0JBQWdCLENBQUM7WUFDcEMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxnQkFBZ0IsR0FBRyxDQUFDLENBQUM7U0FDMUMsQ0FBQztLQUNIO0lBRUQsT0FBTyxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsQ0FBQztBQUNuQyxDQUFDO0FBUUQsU0FBUyxlQUFlLENBQUMsUUFBc0IsRUFBRSxjQUFzQixFQUFFLE1BQXNCO0lBQzdGLElBQUk7UUFDRixNQUFNLFVBQVUsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFD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QUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDLENBQUM7U0FDakQsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7UUFDWCxNQUFNLENBQUMsQ0FBQztJQUNWLENBQUMsQ0FBQyxDQUFDO0NBQ04iLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG4vKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuLy8gc3ltYm9sIHBvbHlmaWxsIG11c3QgZ28gZmlyc3RcbmltcG9ydCAnc3ltYm9sLW9ic2VydmFibGUnO1xuaW1wb3J0IHsgbG9nZ2luZywgc2NoZW1hLCB0YWdzIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgUHJvY2Vzc091dHB1dCwgY3JlYXRlQ29uc29sZUxvZ2dlciB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlL25vZGUnO1xuaW1wb3J0IHsgVW5zdWNjZXNzZnVsV29ya2Zsb3dFeGVjdXRpb24gfSBmcm9tICdAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcyc7XG5pbXBvcnQgeyBOb2RlV29ya2Zsb3cgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcy90b29scyc7XG5pbXBvcnQgKiBhcyBhbnNpQ29sb3JzIGZyb20gJ2Fuc2ktY29sb3JzJztcbmltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBpbnF1aXJlciBmcm9tICdpbnF1aXJlcic7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHlhcmdzUGFyc2VyLCB7IGNhbWVsQ2FzZSwgZGVjYW1lbGl6ZSB9IGZyb20gJ3lhcmdzLXBhcnNlcic7XG5cbi8qKlxuICogUGFyc2UgdGhlIG5hbWUgb2Ygc2NoZW1hdGljIHBhc3NlZCBpbiBhcmd1bWVudCwgYW5kIHJldHVybiBhIHtjb2xsZWN0aW9uLCBzY2hlbWF0aWN9IG5hbWVkXG4gKiB0dXBsZS4gVGhlIHVzZXIgY2FuIHBhc3MgaW4gYGNvbGxlY3Rpb24tbmFtZTpzY2hlbWF0aWMtbmFtZWAsIGFuZCB0aGlzIGZ1bmN0aW9uIHdpbGwgZWl0aGVyXG4gKiByZXR1cm4gYHtjb2xsZWN0aW9uOiAnY29sbGVjdGlvbi1uYW1lJywgc2NoZW1hdGljOiAnc2NoZW1hdGljLW5hbWUnfWAsIG9yIGl0IHdpbGwgZXJyb3Igb3V0XG4gKiBhbmQgc2hvdyB1c2FnZS5cbiAqXG4gKiBJbiB0aGUgY2FzZSB3aGVyZSBhIGNvbGxlY3Rpb24gbmFtZSBpc24ndCBwYXJ0IG9mIHRoZSBhcmd1bWVudCwgdGhlIGRlZmF1bHQgaXMgdG8gdXNlIHRoZVxuICogc2NoZW1hdGljcyBwYWNrYWdlIChAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcy1jbGkpIGFzIHRoZSBjb2xsZWN0aW9uLlxuICpcbiAqIFRoaXMgbG9naWMgaXMgZW50aXJlbHkgdXAgdG8gdGhlIHRvb2xpbmcuXG4gKlxuICogQHBhcmFtIHN0ciBUaGUgYXJndW1lbnQgdG8gcGFyc2UuXG4gKiBAcmV0dXJuIHt7Y29sbGVjdGlvbjogc3RyaW5nLCBzY2hlbWF0aWM6IChzdHJpbmcpfX1cbiAqL1xuZnVuY3Rpb24gcGFyc2VTY2hlbWF0aWNOYW1lKHN0cjogc3RyaW5nIHwgbnVsbCk6IHsgY29sbGVjdGlvbjogc3RyaW5nOyBzY2hlbWF0aWM6IHN0cmluZyB8IG51bGwgfSB7XG4gIGxldCBjb2xsZWN0aW9uID0gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzLWNsaSc7XG5cbiAgbGV0IHNjaGVtYXRpYyA9IHN0cjtcbiAgaWYgKHNjaGVtYXRpYz8uaW5jbHVkZXMoJzonKSkge1xuICAgIGNvbnN0IGxhc3RJbmRleE9mQ29sb24gPSBzY2hlbWF0aWMubGFzdEluZGV4T2YoJzonKTtcbiAgICBbY29sbGVjdGlvbiwgc2NoZW1hdGljXSA9IFtcbiAgICAgIHNjaGVtYXRpYy5zbGljZSgwLCBsYXN0SW5kZXhPZkNvbG9uKSxcbiAgICAgIHNjaGVtYXRpYy5zdWJzdHJpbmcobGFzdEluZGV4T2ZDb2xvbiArIDEpLFxuICAgIF07XG4gIH1cblxuICByZXR1cm4geyBjb2xsZWN0aW9uLCBzY2hlbWF0aWMgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBNYWluT3B0aW9ucyB7XG4gIGFyZ3M6IHN0cmluZ1tdO1xuICBzdGRvdXQ/OiBQcm9jZXNzT3V0cHV0O1xuICBzdGRlcnI/OiBQcm9jZXNzT3V0cHV0O1xufVxuXG5mdW5jdGlvbiBfbGlzdFNjaGVtYXRpY3Mod29ya2Zsb3c6IE5vZGVXb3JrZmxvdywgY29sbGVjdGlvbk5hbWU6IHN0cmluZywgbG9nZ2VyOiBsb2dnaW5nLkxvZ2dlcikge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbGxlY3Rpb24gPSB3b3JrZmxvdy5lbmdpbmUuY3JlYXRlQ29sbGVjdGlvbihjb2xsZWN0aW9uTmFtZSk7XG4gICAgbG9nZ2VyLmluZm8oY29sbGVjdGlvbi5saXN0U2NoZW1hdGljTmFtZXMoKS5qb2luKCdcXG4nKSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgbG9nZ2VyLmZhdGFsKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogYCR7ZXJyb3J9YCk7XG5cbiAgICByZXR1cm4gMTtcbiAgfVxuXG4gIHJldHVybiAwO1xufVxuXG5mdW5jdGlvbiBfY3JlYXRlUHJvbXB0UHJvdmlkZXIoKTogc2NoZW1hLlByb21wdFByb3ZpZGVyIHtcbiAgcmV0dXJuIChkZWZpbml0aW9ucykgPT4ge1xuICAgIGNvbnN0IHF1ZXN0aW9uczogaW5xdWlyZXIuUXVlc3Rpb25Db2xsZWN0aW9uID0gZGVmaW5pdGlvbnMubWFwKChkZWZpbml0aW9uKSA9PiB7XG4gICAgICBjb25zdCBxdWVzdGlvbjogaW5xdWlyZXIuUXVlc3Rpb24gPSB7XG4gICAgICAgIG5hbWU6IGRlZmluaXRpb24uaWQsXG4gICAgICAgIG1lc3NhZ2U6IGRlZmluaXRpb24ubWVzc2FnZSxcbiAgICAgICAgZGVmYXVsdDogZGVmaW5pdGlvbi5kZWZhdWx0LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgdmFsaWRhdG9yID0gZGVmaW5pdGlvbi52YWxpZGF0b3I7XG4gICAgICBpZiAodmFsaWRhdG9yKSB7XG4gICAgICAgIHF1ZXN0aW9uLnZhbGlkYXRlID0gKGlucHV0KSA9PiB2YWxpZGF0b3IoaW5wdXQpO1xuICAgICAgfVxuXG4gICAgICBzd2l0Y2ggKGRlZmluaXRpb24udHlwZSkge1xuICAgICAgICBjYXNlICdjb25maXJtYXRpb24nOlxuICAgICAgICAgIHJldHVybiB7IC4uLnF1ZXN0aW9uLCB0eXBlOiAnY29uZmlybScgfTtcbiAgICAgICAgY2FzZSAnbGlzdCc6XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLnF1ZXN0aW9uLFxuICAgICAgICAgICAgdHlwZTogZGVmaW5pdGlvbi5tdWx0aXNlbGVjdCA/ICdjaGVja2JveCcgOiAnbGlzdCcsXG4gICAgICAgICAgICBjaG9pY2VzOlxuICAgICAgICAgICAgICBkZWZpbml0aW9uLml0ZW1zICYmXG4gICAgICAgICAgICAgIGRlZmluaXRpb24uaXRlbXMubWFwKChpdGVtKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBpdGVtID09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gaXRlbTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogaXRlbS5sYWJlbCxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGl0ZW0udmFsdWUsXG4gICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgfTtcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICByZXR1cm4geyAuLi5xdWVzdGlvbiwgdHlwZTogZGVmaW5pdGlvbi50eXBlIH07XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gaW5xdWlyZXIucHJvbXB0KHF1ZXN0aW9ucyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGZpbmRVcChuYW1lczogc3RyaW5nIHwgc3RyaW5nW10sIGZyb206IHN0cmluZykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkobmFtZXMpKSB7XG4gICAgbmFtZXMgPSBbbmFtZXNdO1xuICB9XG4gIGNvbnN0IHJvb3QgPSBwYXRoLnBhcnNlKGZyb20pLnJvb3Q7XG5cbiAgbGV0IGN1cnJlbnREaXIgPSBmcm9tO1xuICB3aGlsZSAoY3VycmVudERpciAmJiBjdXJyZW50RGlyICE9PSByb290KSB7XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIG5hbWVzKSB7XG4gICAgICBjb25zdCBwID0gcGF0aC5qb2luKGN1cnJlbnREaXIsIG5hbWUpO1xuICAgICAgaWYgKGV4aXN0c1N5bmMocCkpIHtcbiAgICAgICAgcmV0dXJuIHA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY3VycmVudERpciA9IHBhdGguZGlybmFtZShjdXJyZW50RGlyKTtcbiAgfVxuXG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIHJldHVybiBwYWNrYWdlIG1hbmFnZXInIG5hbWUgYnkgbG9jayBmaWxlXG4gKi9cbmZ1bmN0aW9uIGdldFBhY2thZ2VNYW5hZ2VyTmFtZSgpIHtcbiAgLy8gb3JkZXIgYnkgY2hlY2sgcHJpb3JpdHlcbiAgY29uc3QgTE9DS1M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgJ3BhY2thZ2UtbG9jay5qc29uJzogJ25wbScsXG4gICAgJ3lhcm4ubG9jayc6ICd5YXJuJyxcbiAgICAncG5wbS1sb2NrLnlhbWwnOiAncG5wbScsXG4gIH07XG4gIGNvbnN0IGxvY2tQYXRoID0gZmluZFVwKE9iamVjdC5rZXlzKExPQ0tTKSwgcHJvY2Vzcy5jd2QoKSk7XG4gIGlmIChsb2NrUGF0aCkge1xuICAgIHJldHVybiBMT0NLU1twYXRoLmJhc2VuYW1lKGxvY2tQYXRoKV07XG4gIH1cblxuICByZXR1cm4gJ25wbSc7XG59XG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBtYXgtbGluZXMtcGVyLWZ1bmN0aW9uXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWFpbih7XG4gIGFyZ3MsXG4gIHN0ZG91dCA9IHByb2Nlc3Muc3Rkb3V0LFxuICBzdGRlcnIgPSBwcm9jZXNzLnN0ZGVycixcbn06IE1haW5PcHRpb25zKTogUHJvbWlzZTwwIHwgMT4ge1xuICBjb25zdCB7IGNsaU9wdGlvbnMsIHNjaGVtYXRpY09wdGlvbnMsIF8gfSA9IHBhcnNlQXJncyhhcmdzKTtcblxuICAvLyBDcmVhdGUgYSBzZXBhcmF0ZSBpbnN0YW5jZSB0byBwcmV2ZW50IHVuaW50ZW5kZWQgZ2xvYmFsIGNoYW5nZXMgdG8gdGhlIGNvbG9yIGNvbmZpZ3VyYXRpb25cbiAgY29uc3QgY29sb3JzID0gYW5zaUNvbG9ycy5jcmVhdGUoKTtcblxuICAvKiogQ3JlYXRlIHRoZSBEZXZLaXQgTG9nZ2VyIHVzZWQgdGhyb3VnaCB0aGUgQ0xJLiAqL1xuICBjb25zdCBsb2dnZXIgPSBjcmVhdGVDb25zb2xlTG9nZ2VyKCEhY2xpT3B0aW9ucy52ZXJib3NlLCBzdGRvdXQsIHN0ZGVyciwge1xuICAgIGluZm86IChzKSA9PiBzLFxuICAgIGRlYnVnOiAocykgPT4gcyxcbiAgICB3YXJuOiAocykgPT4gY29sb3JzLmJvbGQueWVsbG93KHMpLFxuICAgIGVycm9yOiAocykgPT4gY29sb3JzLmJvbGQucmVkKHMpLFxuICAgIGZhdGFsOiAocykgPT4gY29sb3JzLmJvbGQucmVkKHMpLFxuICB9KTtcblxuICBpZiAoY2xpT3B0aW9ucy5oZWxwKSB7XG4gICAgbG9nZ2VyLmluZm8oZ2V0VXNhZ2UoKSk7XG5cbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIC8qKiBHZXQgdGhlIGNvbGxlY3Rpb24gYW4gc2NoZW1hdGljIG5hbWUgZnJvbSB0aGUgZmlyc3QgYXJndW1lbnQuICovXG4gIGNvbnN0IHsgY29sbGVjdGlvbjogY29sbGVjdGlvbk5hbWUsIHNjaGVtYXRpYzogc2NoZW1hdGljTmFtZSB9ID0gcGFyc2VTY2hlbWF0aWNOYW1lKFxuICAgIF8uc2hpZnQoKSB8fCBudWxsLFxuICApO1xuXG4gIGNvbnN0IGlzTG9jYWxDb2xsZWN0aW9uID0gY29sbGVjdGlvbk5hbWUuc3RhcnRzV2l0aCgnLicpIHx8IGNvbGxlY3Rpb25OYW1lLnN0YXJ0c1dpdGgoJy8nKTtcblxuICAvKiogR2F0aGVyIHRoZSBhcmd1bWVudHMgZm9yIGxhdGVyIHVzZS4gKi9cbiAgY29uc3QgZGVidWdQcmVzZW50ID0gY2xpT3B0aW9ucy5kZWJ1ZyAhPT0gbnVsbDtcbiAgY29uc3QgZGVidWcgPSBkZWJ1Z1ByZXNlbnQgPyAhIWNsaU9wdGlvbnMuZGVidWcgOiBpc0xvY2FsQ29sbGVjdGlvbjtcbiAgY29uc3QgZHJ5UnVuUHJlc2VudCA9IGNsaU9wdGlvbnNbJ2RyeS1ydW4nXSAhPT0gbnVsbDtcbiAgY29uc3QgZHJ5UnVuID0gZHJ5UnVuUHJlc2VudCA/ICEhY2xpT3B0aW9uc1snZHJ5LXJ1biddIDogZGVidWc7XG4gIGNvbnN0IGZvcmNlID0gISFjbGlPcHRpb25zLmZvcmNlO1xuICBjb25zdCBhbGxvd1ByaXZhdGUgPSAhIWNsaU9wdGlvbnNbJ2FsbG93LXByaXZhdGUnXTtcblxuICAvKiogQ3JlYXRlIHRoZSB3b3JrZmxvdyBzY29wZWQgdG8gdGhlIHdvcmtpbmcgZGlyZWN0b3J5IHRoYXQgd2lsbCBiZSBleGVjdXRlZCB3aXRoIHRoaXMgcnVuLiAqL1xuICBjb25zdCB3b3JrZmxvdyA9IG5ldyBOb2RlV29ya2Zsb3cocHJvY2Vzcy5jd2QoKSwge1xuICAgIGZvcmNlLFxuICAgIGRyeVJ1bixcbiAgICByZXNvbHZlUGF0aHM6IFtwcm9jZXNzLmN3ZCgpLCBfX2Rpcm5hbWVdLFxuICAgIHNjaGVtYVZhbGlkYXRpb246IHRydWUsXG4gICAgcGFja2FnZU1hbmFnZXI6IGdldFBhY2thZ2VNYW5hZ2VyTmFtZSgpLFxuICB9KTtcblxuICAvKiogSWYgdGhlIHVzZXIgd2FudHMgdG8gbGlzdCBzY2hlbWF0aWNzLCB3ZSBzaW1wbHkgc2hvdyBhbGwgdGhlIHNjaGVtYXRpYyBuYW1lcy4gKi9cbiAgaWYgKGNsaU9wdGlvbnNbJ2xpc3Qtc2NoZW1hdGljcyddKSB7XG4gICAgcmV0dXJuIF9saXN0U2NoZW1hdGljcyh3b3JrZmxvdywgY29sbGVjdGlvbk5hbWUsIGxvZ2dlcik7XG4gIH1cblxuICBpZiAoIXNjaGVtYXRpY05hbWUpIHtcbiAgICBsb2dnZXIuaW5mbyhnZXRVc2FnZSgpKTtcblxuICAgIHJldHVybiAxO1xuICB9XG5cbiAgaWYgKGRlYnVnKSB7XG4gICAgbG9nZ2VyLmluZm8oXG4gICAgICBgRGVidWcgbW9kZSBlbmFibGVkJHtpc0xvY2FsQ29sbGVjdGlvbiA/ICcgYnkgZGVmYXVsdCBmb3IgbG9jYWwgY29sbGVjdGlvbnMnIDogJyd9LmAsXG4gICAgKTtcbiAgfVxuXG4gIC8vIEluZGljYXRlIHRvIHRoZSB1c2VyIHdoZW4gbm90aGluZyBoYXMgYmVlbiBkb25lLiBUaGlzIGlzIGF1dG9tYXRpY2FsbHkgc2V0IHRvIG9mZiB3aGVuIHRoZXJlJ3NcbiAgLy8gYSBuZXcgRHJ5UnVuRXZlbnQuXG4gIGxldCBub3RoaW5nRG9uZSA9IHRydWU7XG5cbiAgLy8gTG9nZ2luZyBxdWV1ZSB0aGF0IHJlY2VpdmVzIGFsbCB0aGUgbWVzc2FnZXMgdG8gc2hvdyB0aGUgdXNlcnMuIFRoaXMgb25seSBnZXQgc2hvd24gd2hlbiBub1xuICAvLyBlcnJvcnMgaGFwcGVuZWQuXG4gIGxldCBsb2dnaW5nUXVldWU6IHN0cmluZ1tdID0gW107XG4gIGxldCBlcnJvciA9IGZhbHNlO1xuXG4gIC8qKlxuICAgKiBMb2dzIG91dCBkcnkgcnVuIGV2ZW50cy5cbiAgICpcbiAgICogQWxsIGV2ZW50cyB3aWxsIGFsd2F5cyBiZSBleGVjdXRlZCBoZXJlLCBpbiBvcmRlciBvZiBkaXNjb3ZlcnkuIFRoYXQgbWVhbnMgdGhhdCBhbiBlcnJvciB3b3VsZFxuICAgKiBiZSBzaG93biBhbG9uZyBvdGhlciBldmVudHMgd2hlbiBpdCBoYXBwZW5zLiBTaW5jZSBlcnJvcnMgaW4gd29ya2Zsb3dzIHdpbGwgc3RvcCB0aGUgT2JzZXJ2YWJsZVxuICAgKiBmcm9tIGNvbXBsZXRpbmcgc3VjY2Vzc2Z1bGx5LCB3ZSByZWNvcmQgYW55IGV2ZW50cyBvdGhlciB0aGFuIGVycm9ycywgdGhlbiBvbiBjb21wbGV0aW9uIHdlXG4gICAqIHNob3cgdGhlbS5cbiAgICpcbiAgICogVGhpcyBpcyBhIHNpbXBsZSB3YXkgdG8gb25seSBzaG93IGVycm9ycyB3aGVuIGFuIGVycm9yIG9jY3VyLlxuICAgKi9cbiAgd29ya2Zsb3cucmVwb3J0ZXIuc3Vic2NyaWJlKChldmVudCkgPT4ge1xuICAgIG5vdGhpbmdEb25lID0gZmFsc2U7XG4gICAgLy8gU3RyaXAgbGVhZGluZyBzbGFzaCB0byBwcmV2ZW50IGNvbmZ1c2lvbi5cbiAgICBjb25zdCBldmVudFBhdGggPSBldmVudC5wYXRoLnN0YXJ0c1dpdGgoJy8nKSA/IGV2ZW50LnBhdGguc2xpY2UoMSkgOiBldmVudC5wYXRoO1xuXG4gICAgc3dpdGNoIChldmVudC5raW5kKSB7XG4gICAgICBjYXNlICdlcnJvcic6XG4gICAgICAgIGVycm9yID0gdHJ1ZTtcblxuICAgICAgICBjb25zdCBkZXNjID0gZXZlbnQuZGVzY3JpcHRpb24gPT0gJ2FscmVhZHlFeGlzdCcgPyAnYWxyZWFkeSBleGlzdHMnIDogJ2RvZXMgbm90IGV4aXN0JztcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBFUlJPUiEgJHtldmVudFBhdGh9ICR7ZGVzY30uYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndXBkYXRlJzpcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7Y29sb3JzLmN5YW4oJ1VQREFURScpfSAke2V2ZW50UGF0aH0gKCR7ZXZlbnQuY29udGVudC5sZW5ndGh9IGJ5dGVzKWApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke2NvbG9ycy5ncmVlbignQ1JFQVRFJyl9ICR7ZXZlbnRQYXRofSAoJHtldmVudC5jb250ZW50Lmxlbmd0aH0gYnl0ZXMpYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7Y29sb3JzLnllbGxvdygnREVMRVRFJyl9ICR7ZXZlbnRQYXRofWApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3JlbmFtZSc6XG4gICAgICAgIGNvbnN0IGV2ZW50VG9QYXRoID0gZXZlbnQudG8uc3RhcnRzV2l0aCgnLycpID8gZXZlbnQudG8uc2xpY2UoMSkgOiBldmVudC50bztcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7Y29sb3JzLmJsdWUoJ1JFTkFNRScpfSAke2V2ZW50UGF0aH0gPT4gJHtldmVudFRvUGF0aH1gKTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9KTtcblxuICAvKipcbiAgICogTGlzdGVuIHRvIGxpZmVjeWNsZSBldmVudHMgb2YgdGhlIHdvcmtmbG93IHRvIGZsdXNoIHRoZSBsb2dzIGJldHdlZW4gZWFjaCBwaGFzZXMuXG4gICAqL1xuICB3b3JrZmxvdy5saWZlQ3ljbGUuc3Vic2NyaWJlKChldmVudCkgPT4ge1xuICAgIGlmIChldmVudC5raW5kID09ICd3b3JrZmxvdy1lbmQnIHx8IGV2ZW50LmtpbmQgPT0gJ3Bvc3QtdGFza3Mtc3RhcnQnKSB7XG4gICAgICBpZiAoIWVycm9yKSB7XG4gICAgICAgIC8vIEZsdXNoIHRoZSBsb2cgcXVldWUgYW5kIGNsZWFuIHRoZSBlcnJvciBzdGF0ZS5cbiAgICAgICAgbG9nZ2luZ1F1ZXVlLmZvckVhY2goKGxvZykgPT4gbG9nZ2VyLmluZm8obG9nKSk7XG4gICAgICB9XG5cbiAgICAgIGxvZ2dpbmdRdWV1ZSA9IFtdO1xuICAgICAgZXJyb3IgPSBmYWxzZTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIFNob3cgdXNhZ2Ugb2YgZGVwcmVjYXRlZCBvcHRpb25zXG4gIHdvcmtmbG93LnJlZ2lzdHJ5LnVzZVhEZXByZWNhdGVkUHJvdmlkZXIoKG1zZykgPT4gbG9nZ2VyLndhcm4obXNnKSk7XG5cbiAgLy8gUGFzcyB0aGUgcmVzdCBvZiB0aGUgYXJndW1lbnRzIGFzIHRoZSBzbWFydCBkZWZhdWx0IFwiYXJndlwiLiBUaGVuIGRlbGV0ZSBpdC5cbiAgd29ya2Zsb3cucmVnaXN0cnkuYWRkU21hcnREZWZhdWx0UHJvdmlkZXIoJ2FyZ3YnLCAoc2NoZW1hKSA9PlxuICAgICdpbmRleCcgaW4gc2NoZW1hID8gX1tOdW1iZXIoc2NoZW1hWydpbmRleCddKV0gOiBfLFxuICApO1xuXG4gIC8vIEFkZCBwcm9tcHRzLlxuICBpZiAoY2xpT3B0aW9ucy5pbnRlcmFjdGl2ZSAmJiBpc1RUWSgpKSB7XG4gICAgd29ya2Zsb3cucmVnaXN0cnkudXNlUHJvbXB0UHJvdmlkZXIoX2NyZWF0ZVByb21wdFByb3ZpZGVyKCkpO1xuICB9XG5cbiAgLyoqXG4gICAqICBFeGVjdXRlIHRoZSB3b3JrZmxvdywgd2hpY2ggd2lsbCByZXBvcnQgdGhlIGRyeSBydW4gZXZlbnRzLCBydW4gdGhlIHRhc2tzLCBhbmQgY29tcGxldGVcbiAgICogIGFmdGVyIGFsbCBpcyBkb25lLlxuICAgKlxuICAgKiAgVGhlIE9ic2VydmFibGUgcmV0dXJuZWQgd2lsbCBwcm9wZXJseSBjYW5jZWwgdGhlIHdvcmtmbG93IGlmIHVuc3Vic2NyaWJlZCwgZXJyb3Igb3V0IGlmIEFOWVxuICAgKiAgc3RlcCBvZiB0aGUgd29ya2Zsb3cgZmFpbGVkIChzaW5rIG9yIHRhc2spLCB3aXRoIGRldGFpbHMgaW5jbHVkZWQsIGFuZCB3aWxsIG9ubHkgY29tcGxldGVcbiAgICogIHdoZW4gZXZlcnl0aGluZyBpcyBkb25lLlxuICAgKi9cbiAgdHJ5IHtcbiAgICBhd2FpdCB3b3JrZmxvd1xuICAgICAgLmV4ZWN1dGUoe1xuICAgICAgICBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSxcbiAgICAgICAgc2NoZW1hdGljOiBzY2hlbWF0aWNOYW1lLFxuICAgICAgICBvcHRpb25zOiBzY2hlbWF0aWNPcHRpb25zLFxuICAgICAgICBhbGxvd1ByaXZhdGU6IGFsbG93UHJpdmF0ZSxcbiAgICAgICAgZGVidWc6IGRlYnVnLFxuICAgICAgICBsb2dnZXI6IGxvZ2dlcixcbiAgICAgIH0pXG4gICAgICAudG9Qcm9taXNlKCk7XG5cbiAgICBpZiAobm90aGluZ0RvbmUpIHtcbiAgICAgIGxvZ2dlci5pbmZvKCdOb3RoaW5nIHRvIGJlIGRvbmUuJyk7XG4gICAgfSBlbHNlIGlmIChkcnlSdW4pIHtcbiAgICAgIGxvZ2dlci5pbmZvKFxuICAgICAgICBgRHJ5IHJ1biBlbmFibGVkJHtcbiAgICAgICAgICBkcnlSdW5QcmVzZW50ID8gJycgOiAnIGJ5IGRlZmF1bHQgaW4gZGVidWcgbW9kZSdcbiAgICAgICAgfS4gTm8gZmlsZXMgd3JpdHRlbiB0byBkaXNrLmAsXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiAwO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBpZiAoZXJyIGluc3RhbmNlb2YgVW5zdWNjZXNzZnVsV29ya2Zsb3dFeGVjdXRpb24pIHtcbiAgICAgIC8vIFwiU2VlIGFib3ZlXCIgYmVjYXVzZSB3ZSBhbHJlYWR5IHByaW50ZWQgdGhlIGVycm9yLlxuICAgICAgbG9nZ2VyLmZhdGFsKCdUaGUgU2NoZW1hdGljIHdvcmtmbG93IGZhaWxlZC4gU2VlIGFib3ZlLicpO1xuICAgIH0gZWxzZSBpZiAoZGVidWcgJiYgZXJyIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgIGxvZ2dlci5mYXRhbChgQW4gZXJyb3Igb2NjdXJlZDpcXG4ke2Vyci5zdGFja31gKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbG9nZ2VyLmZhdGFsKGBFcnJvcjogJHtlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogZXJyfWApO1xuICAgIH1cblxuICAgIHJldHVybiAxO1xuICB9XG59XG5cbi8qKlxuICogR2V0IHVzYWdlIG9mIHRoZSBDTEkgdG9vbC5cbiAqL1xuZnVuY3Rpb24gZ2V0VXNhZ2UoKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRhZ3Muc3RyaXBJbmRlbnRgXG4gIHNjaGVtYXRpY3MgW2NvbGxlY3Rpb24tbmFtZTpdc2NoZW1hdGljLW5hbWUgW29wdGlvbnMsIC4uLl1cblxuICBCeSBkZWZhdWx0LCBpZiB0aGUgY29sbGVjdGlvbiBuYW1lIGlzIG5vdCBzcGVjaWZpZWQsIHVzZSB0aGUgaW50ZXJuYWwgY29sbGVjdGlvbiBwcm92aWRlZFxuICBieSB0aGUgU2NoZW1hdGljcyBDTEkuXG5cbiAgT3B0aW9uczpcbiAgICAgIC0tZGVidWcgICAgICAgICAgICAgRGVidWcgbW9kZS4gVGhpcyBpcyB0cnVlIGJ5IGRlZmF1bHQgaWYgdGhlIGNvbGxlY3Rpb24gaXMgYSByZWxhdGl2ZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoIChpbiB0aGF0IGNhc2UsIHR1cm4gb2ZmIHdpdGggLS1kZWJ1Zz1mYWxzZSkuXG5cbiAgICAgIC0tYWxsb3ctcHJpdmF0ZSAgICAgQWxsb3cgcHJpdmF0ZSBzY2hlbWF0aWNzIHRvIGJlIHJ1biBmcm9tIHRoZSBjb21tYW5kIGxpbmUuIERlZmF1bHQgdG9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgZmFsc2UuXG5cbiAgICAgIC0tZHJ5LXJ1biAgICAgICAgICAgRG8gbm90IG91dHB1dCBhbnl0aGluZywgYnV0IGluc3RlYWQganVzdCBzaG93IHdoYXQgYWN0aW9ucyB3b3VsZCBiZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJmb3JtZWQuIERlZmF1bHQgdG8gdHJ1ZSBpZiBkZWJ1ZyBpcyBhbHNvIHRydWUuXG5cbiAgICAgIC0tZm9yY2UgICAgICAgICAgICAgRm9yY2Ugb3ZlcndyaXRpbmcgZmlsZXMgdGhhdCB3b3VsZCBvdGhlcndpc2UgYmUgYW4gZXJyb3IuXG5cbiAgICAgIC0tbGlzdC1zY2hlbWF0aWNzICAgTGlzdCBhbGwgc2NoZW1hdGljcyBmcm9tIHRoZSBjb2xsZWN0aW9uLCBieSBuYW1lLiBBIGNvbGxlY3Rpb24gbmFtZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBzaG91bGQgYmUgc3VmZml4ZWQgYnkgYSBjb2xvbi4gRXhhbXBsZTogJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzLWNsaTonLlxuXG4gICAgICAtLW5vLWludGVyYWN0aXZlICAgIERpc2FibGVzIGludGVyYWN0aXZlIGlucHV0IHByb21wdHMuXG5cbiAgICAgIC0tdmVyYm9zZSAgICAgICAgICAgU2hvdyBtb3JlIGluZm9ybWF0aW9uLlxuXG4gICAgICAtLWhlbHAgICAgICAgICAgICAgIFNob3cgdGhpcyBtZXNzYWdlLlxuXG4gIEFueSBhZGRpdGlvbmFsIG9wdGlvbiBpcyBwYXNzZWQgdG8gdGhlIFNjaGVtYXRpY3MgZGVwZW5kaW5nIG9uIGl0cyBzY2hlbWEuXG4gIGA7XG59XG5cbi8qKiBQYXJzZSB0aGUgY29tbWFuZCBsaW5lLiAqL1xuY29uc3QgYm9vbGVhbkFyZ3MgPSBbXG4gICdhbGxvdy1wcml2YXRlJyxcbiAgJ2RlYnVnJyxcbiAgJ2RyeS1ydW4nLFxuICAnZm9yY2UnLFxuICAnaGVscCcsXG4gICdsaXN0LXNjaGVtYXRpY3MnLFxuICAndmVyYm9zZScsXG4gICdpbnRlcmFjdGl2ZScsXG5dIGFzIGNvbnN0O1xuXG50eXBlIEVsZW1lbnRUeXBlPFQgZXh0ZW5kcyBSZWFkb25seUFycmF5PHVua25vd24+PiA9IFQgZXh0ZW5kcyBSZWFkb25seUFycmF5PGluZmVyIEVsZW1lbnRUeXBlPlxuICA/IEVsZW1lbnRUeXBlXG4gIDogbmV2ZXI7XG5cbmludGVyZmFjZSBPcHRpb25zIHtcbiAgXzogc3RyaW5nW107XG4gIHNjaGVtYXRpY09wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBjbGlPcHRpb25zOiBQYXJ0aWFsPFJlY29yZDxFbGVtZW50VHlwZTx0eXBlb2YgYm9vbGVhbkFyZ3M+LCBib29sZWFuIHwgbnVsbD4+O1xufVxuXG4vKiogUGFyc2UgdGhlIGNvbW1hbmQgbGluZS4gKi9cbmZ1bmN0aW9uIHBhcnNlQXJncyhhcmdzOiBzdHJpbmdbXSk6IE9wdGlvbnMge1xuICBjb25zdCB7IF8sIC4uLm9wdGlvbnMgfSA9IHlhcmdzUGFyc2VyKGFyZ3MsIHtcbiAgICBib29sZWFuOiBib29sZWFuQXJncyBhcyB1bmtub3duIGFzIHN0cmluZ1tdLFxuICAgIGRlZmF1bHQ6IHtcbiAgICAgICdpbnRlcmFjdGl2ZSc6IHRydWUsXG4gICAgICAnZGVidWcnOiBudWxsLFxuICAgICAgJ2RyeS1ydW4nOiBudWxsLFxuICAgIH0sXG4gICAgY29uZmlndXJhdGlvbjoge1xuICAgICAgJ2RvdC1ub3RhdGlvbic6IGZhbHNlLFxuICAgICAgJ2Jvb2xlYW4tbmVnYXRpb24nOiB0cnVlLFxuICAgICAgJ3N0cmlwLWFsaWFzZWQnOiB0cnVlLFxuICAgICAgJ2NhbWVsLWNhc2UtZXhwYW5zaW9uJzogZmFsc2UsXG4gICAgfSxcbiAgfSk7XG5cbiAgLy8gQ2FtZWxpemUgb3B0aW9ucyBhcyB5YXJncyB3aWxsIHJldHVybiB0aGUgb2JqZWN0IGluIGtlYmFiLWNhc2Ugd2hlbiBjYW1lbCBjYXNpbmcgaXMgZGlzYWJsZWQuXG4gIGNvbnN0IHNjaGVtYXRpY09wdGlvbnM6IE9wdGlvbnNbJ3NjaGVtYXRpY09wdGlvbnMnXSA9IHt9O1xuICBjb25zdCBjbGlPcHRpb25zOiBPcHRpb25zWydjbGlPcHRpb25zJ10gPSB7fTtcblxuICBjb25zdCBpc0NsaU9wdGlvbnMgPSAoXG4gICAga2V5OiBFbGVtZW50VHlwZTx0eXBlb2YgYm9vbGVhbkFyZ3M+IHwgc3RyaW5nLFxuICApOiBrZXkgaXMgRWxlbWVudFR5cGU8dHlwZW9mIGJvb2xlYW5BcmdzPiA9PlxuICAgIGJvb2xlYW5BcmdzLmluY2x1ZGVzKGtleSBhcyBFbGVtZW50VHlwZTx0eXBlb2YgYm9vbGVhbkFyZ3M+KTtcblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhvcHRpb25zKSkge1xuICAgIGlmICgvW0EtWl0vLnRlc3Qoa2V5KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGFyZ3VtZW50ICR7a2V5fS4gRGlkIHlvdSBtZWFuICR7ZGVjYW1lbGl6ZShrZXkpfT9gKTtcbiAgICB9XG5cbiAgICBpZiAoaXNDbGlPcHRpb25zKGtleSkpIHtcbiAgICAgIGNsaU9wdGlvbnNba2V5XSA9IHZhbHVlO1xuICAgIH0gZWxzZSB7XG4gICAgICBzY2hlbWF0aWNPcHRpb25zW2NhbWVsQ2FzZShrZXkpXSA9IHZhbHVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgXzogXy5tYXAoKHYpID0+IHYudG9TdHJpbmcoKSksXG4gICAgc2NoZW1hdGljT3B0aW9ucyxcbiAgICBjbGlPcHRpb25zLFxuICB9O1xufVxuXG5mdW5jdGlvbiBpc1RUWSgpOiBib29sZWFuIHtcbiAgY29uc3QgaXNUcnV0aHkgPSAodmFsdWU6IHVuZGVmaW5lZCB8IHN0cmluZykgPT4ge1xuICAgIC8vIFJldHVybnMgdHJ1ZSBpZiB2YWx1ZSBpcyBhIHN0cmluZyB0aGF0IGlzIGFueXRoaW5nIGJ1dCAwIG9yIGZhbHNlLlxuICAgIHJldHVybiB2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSAnMCcgJiYgdmFsdWUudG9VcHBlckNhc2UoKSAhPT0gJ0ZBTFNFJztcbiAgfTtcblxuICAvLyBJZiB3ZSBmb3JjZSBUVFksIHdlIGFsd2F5cyByZXR1cm4gdHJ1ZS5cbiAgY29uc3QgZm9yY2UgPSBwcm9jZXNzLmVudlsnTkdfRk9SQ0VfVFRZJ107XG4gIGlmIChmb3JjZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGlzVHJ1dGh5KGZvcmNlKTtcbiAgfVxuXG4gIHJldHVybiAhIXByb2Nlc3Muc3Rkb3V0LmlzVFRZICYmICFpc1RydXRoeShwcm9jZXNzLmVudlsnQ0knXSk7XG59XG5cbmlmIChyZXF1aXJlLm1haW4gPT09IG1vZHVsZSkge1xuICBjb25zdCBhcmdzID0gcHJvY2Vzcy5hcmd2LnNsaWNlKDIpO1xuICBtYWluKHsgYXJncyB9KVxuICAgIC50aGVuKChleGl0Q29kZSkgPT4gKHByb2Nlc3MuZXhpdENvZGUgPSBleGl0Q29kZSkpXG4gICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICB0aHJvdyBlO1xuICAgIH0pO1xufVxuIl19