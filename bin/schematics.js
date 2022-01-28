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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
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
const minimist_1 = __importDefault(require("minimist"));
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
    if (schematic && schematic.indexOf(':') != -1) {
        [collection, schematic] = [
            schematic.slice(0, schematic.lastIndexOf(':')),
            schematic.substring(schematic.lastIndexOf(':') + 1),
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
    const argv = parseArgs(args);
    // Create a separate instance to prevent unintended global changes to the color configuration
    // Create function is not defined in the typings. See: https://github.com/doowb/ansi-colors/pull/44
    const colors = ansiColors.create();
    /** Create the DevKit Logger used through the CLI. */
    const logger = (0, node_1.createConsoleLogger)(argv['verbose'], stdout, stderr, {
        info: (s) => s,
        debug: (s) => s,
        warn: (s) => colors.bold.yellow(s),
        error: (s) => colors.bold.red(s),
        fatal: (s) => colors.bold.red(s),
    });
    if (argv.help) {
        logger.info(getUsage());
        return 0;
    }
    /** Get the collection an schematic name from the first argument. */
    const { collection: collectionName, schematic: schematicName } = parseSchematicName(argv._.shift() || null);
    const isLocalCollection = collectionName.startsWith('.') || collectionName.startsWith('/');
    /** Gather the arguments for later use. */
    const debugPresent = argv['debug'] !== null;
    const debug = debugPresent ? !!argv['debug'] : isLocalCollection;
    const dryRunPresent = argv['dry-run'] !== null;
    const dryRun = dryRunPresent ? !!argv['dry-run'] : debug;
    const force = argv['force'];
    const allowPrivate = argv['allow-private'];
    /** Create the workflow scoped to the working directory that will be executed with this run. */
    const workflow = new tools_1.NodeWorkflow(process.cwd(), {
        force,
        dryRun,
        resolvePaths: [process.cwd(), __dirname],
        schemaValidation: true,
    });
    /** If the user wants to list schematics, we simply show all the schematic names. */
    if (argv['list-schematics']) {
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
    /**
     * Remove every options from argv that we support in schematics itself.
     */
    const parsedArgs = Object.assign({}, argv);
    delete parsedArgs['--'];
    for (const key of booleanArgs) {
        delete parsedArgs[key];
    }
    /**
     * Add options from `--` to args.
     */
    const argv2 = (0, minimist_1.default)(argv['--']);
    for (const key of Object.keys(argv2)) {
        parsedArgs[key] = argv2[key];
    }
    // Show usage of deprecated options
    workflow.registry.useXDeprecatedProvider((msg) => logger.warn(msg));
    // Pass the rest of the arguments as the smart default "argv". Then delete it.
    workflow.registry.addSmartDefaultProvider('argv', (schema) => {
        if ('index' in schema) {
            return argv._[Number(schema['index'])];
        }
        else {
            return argv._;
        }
    });
    delete parsedArgs._;
    // Add prompts.
    if (argv['interactive'] && isTTY()) {
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
            options: parsedArgs,
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
            logger.fatal('An error occured:\n' + err.stack);
        }
        else {
            logger.fatal(err.stack || err.message);
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
  schematics [CollectionName:]SchematicName [options, ...]

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
    'allowPrivate',
    'allow-private',
    'debug',
    'dry-run',
    'dryRun',
    'force',
    'help',
    'list-schematics',
    'listSchematics',
    'verbose',
    'interactive',
];
function parseArgs(args) {
    return (0, minimist_1.default)(args, {
        boolean: booleanArgs,
        alias: {
            'dryRun': 'dry-run',
            'listSchematics': 'list-schematics',
            'allowPrivate': 'allow-private',
        },
        default: {
            'interactive': true,
            'debug': null,
            'dryRun': null,
        },
        '--': true,
    });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2FuZ3VsYXJfZGV2a2l0L3NjaGVtYXRpY3NfY2xpL2Jpbi9zY2hlbWF0aWNzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0E7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsZ0NBQWdDO0FBQ2hDLDZCQUEyQjtBQUMzQiwrQ0FBNkQ7QUFDN0Qsb0RBQStFO0FBQy9FLDJEQUEyRTtBQUMzRSw0REFBZ0U7QUFDaEUsd0RBQTBDO0FBQzFDLG1EQUFxQztBQUNyQyx3REFBZ0M7QUFFaEM7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILFNBQVMsa0JBQWtCLENBQUMsR0FBa0I7SUFDNUMsSUFBSSxVQUFVLEdBQUcsZ0NBQWdDLENBQUM7SUFFbEQsSUFBSSxTQUFTLEdBQUcsR0FBRyxDQUFDO0lBQ3BCLElBQUksU0FBUyxJQUFJLFNBQVMsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUU7UUFDN0MsQ0FBQyxVQUFVLEVBQUUsU0FBUyxDQUFDLEdBQUc7WUFDeEIsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsU0FBUyxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUM5QyxTQUFTLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1NBQ3BELENBQUM7S0FDSDtJQUVELE9BQU8sRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFDbkMsQ0FBQztBQVFELFNBQVMsZUFBZSxDQUFDLFFBQXNCLEVBQUUsY0FBc0IsRUFBRSxNQUFzQjtJQUM3RixJQUFJO1FBQ0YsTUFBTSxVQUFVLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUNwRSxNQUFNLENBQUMsSUFB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QU8sS0FBSyxLQUFLLFNBQVMsSUFBSSxLQUFLLEtBQUssR0FBRyxJQUFJLEtBQUssQ0FBQyxXQUFXLEVBQUUsS0FBSyxPQUFPLENBQUM7SUFDakYsQ0FBQyxDQUFDO0lBRUYsMENBQTBDO0lBQzFDLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUM7SUFDMUMsSUFBSSxLQUFLLEtBQUssU0FBUyxFQUFFO1FBQ3ZCLE9BQU8sUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO0tBQ3hCO0lBRUQsT0FBTyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQ2hFLENBQUM7QUFFRCxJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssTUFBTSxFQUFFO0lBQzNCLE1BQU0sSUFBSSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ25DLElBQUksQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDO1NBQ1gsSUFBSSxDQUFDLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDLENBQUM7U0FDakQsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7UUFDWCxNQUFNLENBQUMsQ0FBQztJQUNWLENBQUMsQ0FBQyxDQUFDO0NBQ04iLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG4vKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuLy8gc3ltYm9sIHBvbHlmaWxsIG11c3QgZ28gZmlyc3RcbmltcG9ydCAnc3ltYm9sLW9ic2VydmFibGUnO1xuaW1wb3J0IHsgbG9nZ2luZywgc2NoZW1hLCB0YWdzIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgUHJvY2Vzc091dHB1dCwgY3JlYXRlQ29uc29sZUxvZ2dlciB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlL25vZGUnO1xuaW1wb3J0IHsgVW5zdWNjZXNzZnVsV29ya2Zsb3dFeGVjdXRpb24gfSBmcm9tICdAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcyc7XG5pbXBvcnQgeyBOb2RlV29ya2Zsb3cgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcy90b29scyc7XG5pbXBvcnQgKiBhcyBhbnNpQ29sb3JzIGZyb20gJ2Fuc2ktY29sb3JzJztcbmltcG9ydCAqIGFzIGlucXVpcmVyIGZyb20gJ2lucXVpcmVyJztcbmltcG9ydCBtaW5pbWlzdCBmcm9tICdtaW5pbWlzdCc7XG5cbi8qKlxuICogUGFyc2UgdGhlIG5hbWUgb2Ygc2NoZW1hdGljIHBhc3NlZCBpbiBhcmd1bWVudCwgYW5kIHJldHVybiBhIHtjb2xsZWN0aW9uLCBzY2hlbWF0aWN9IG5hbWVkXG4gKiB0dXBsZS4gVGhlIHVzZXIgY2FuIHBhc3MgaW4gYGNvbGxlY3Rpb24tbmFtZTpzY2hlbWF0aWMtbmFtZWAsIGFuZCB0aGlzIGZ1bmN0aW9uIHdpbGwgZWl0aGVyXG4gKiByZXR1cm4gYHtjb2xsZWN0aW9uOiAnY29sbGVjdGlvbi1uYW1lJywgc2NoZW1hdGljOiAnc2NoZW1hdGljLW5hbWUnfWAsIG9yIGl0IHdpbGwgZXJyb3Igb3V0XG4gKiBhbmQgc2hvdyB1c2FnZS5cbiAqXG4gKiBJbiB0aGUgY2FzZSB3aGVyZSBhIGNvbGxlY3Rpb24gbmFtZSBpc24ndCBwYXJ0IG9mIHRoZSBhcmd1bWVudCwgdGhlIGRlZmF1bHQgaXMgdG8gdXNlIHRoZVxuICogc2NoZW1hdGljcyBwYWNrYWdlIChAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcy1jbGkpIGFzIHRoZSBjb2xsZWN0aW9uLlxuICpcbiAqIFRoaXMgbG9naWMgaXMgZW50aXJlbHkgdXAgdG8gdGhlIHRvb2xpbmcuXG4gKlxuICogQHBhcmFtIHN0ciBUaGUgYXJndW1lbnQgdG8gcGFyc2UuXG4gKiBAcmV0dXJuIHt7Y29sbGVjdGlvbjogc3RyaW5nLCBzY2hlbWF0aWM6IChzdHJpbmcpfX1cbiAqL1xuZnVuY3Rpb24gcGFyc2VTY2hlbWF0aWNOYW1lKHN0cjogc3RyaW5nIHwgbnVsbCk6IHsgY29sbGVjdGlvbjogc3RyaW5nOyBzY2hlbWF0aWM6IHN0cmluZyB8IG51bGwgfSB7XG4gIGxldCBjb2xsZWN0aW9uID0gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzLWNsaSc7XG5cbiAgbGV0IHNjaGVtYXRpYyA9IHN0cjtcbiAgaWYgKHNjaGVtYXRpYyAmJiBzY2hlbWF0aWMuaW5kZXhPZignOicpICE9IC0xKSB7XG4gICAgW2NvbGxlY3Rpb24sIHNjaGVtYXRpY10gPSBbXG4gICAgICBzY2hlbWF0aWMuc2xpY2UoMCwgc2NoZW1hdGljLmxhc3RJbmRleE9mKCc6JykpLFxuICAgICAgc2NoZW1hdGljLnN1YnN0cmluZyhzY2hlbWF0aWMubGFzdEluZGV4T2YoJzonKSArIDEpLFxuICAgIF07XG4gIH1cblxuICByZXR1cm4geyBjb2xsZWN0aW9uLCBzY2hlbWF0aWMgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBNYWluT3B0aW9ucyB7XG4gIGFyZ3M6IHN0cmluZ1tdO1xuICBzdGRvdXQ/OiBQcm9jZXNzT3V0cHV0O1xuICBzdGRlcnI/OiBQcm9jZXNzT3V0cHV0O1xufVxuXG5mdW5jdGlvbiBfbGlzdFNjaGVtYXRpY3Mod29ya2Zsb3c6IE5vZGVXb3JrZmxvdywgY29sbGVjdGlvbk5hbWU6IHN0cmluZywgbG9nZ2VyOiBsb2dnaW5nLkxvZ2dlcikge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbGxlY3Rpb24gPSB3b3JrZmxvdy5lbmdpbmUuY3JlYXRlQ29sbGVjdGlvbihjb2xsZWN0aW9uTmFtZSk7XG4gICAgbG9nZ2VyLmluZm8oY29sbGVjdGlvbi5saXN0U2NoZW1hdGljTmFtZXMoKS5qb2luKCdcXG4nKSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgbG9nZ2VyLmZhdGFsKGVycm9yLm1lc3NhZ2UpO1xuXG4gICAgcmV0dXJuIDE7XG4gIH1cblxuICByZXR1cm4gMDtcbn1cblxuZnVuY3Rpb24gX2NyZWF0ZVByb21wdFByb3ZpZGVyKCk6IHNjaGVtYS5Qcm9tcHRQcm92aWRlciB7XG4gIHJldHVybiAoZGVmaW5pdGlvbnMpID0+IHtcbiAgICBjb25zdCBxdWVzdGlvbnM6IGlucXVpcmVyLlF1ZXN0aW9uQ29sbGVjdGlvbiA9IGRlZmluaXRpb25zLm1hcCgoZGVmaW5pdGlvbikgPT4ge1xuICAgICAgY29uc3QgcXVlc3Rpb246IGlucXVpcmVyLlF1ZXN0aW9uID0ge1xuICAgICAgICBuYW1lOiBkZWZpbml0aW9uLmlkLFxuICAgICAgICBtZXNzYWdlOiBkZWZpbml0aW9uLm1lc3NhZ2UsXG4gICAgICAgIGRlZmF1bHQ6IGRlZmluaXRpb24uZGVmYXVsdCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHZhbGlkYXRvciA9IGRlZmluaXRpb24udmFsaWRhdG9yO1xuICAgICAgaWYgKHZhbGlkYXRvcikge1xuICAgICAgICBxdWVzdGlvbi52YWxpZGF0ZSA9IChpbnB1dCkgPT4gdmFsaWRhdG9yKGlucHV0KTtcbiAgICAgIH1cblxuICAgICAgc3dpdGNoIChkZWZpbml0aW9uLnR5cGUpIHtcbiAgICAgICAgY2FzZSAnY29uZmlybWF0aW9uJzpcbiAgICAgICAgICByZXR1cm4geyAuLi5xdWVzdGlvbiwgdHlwZTogJ2NvbmZpcm0nIH07XG4gICAgICAgIGNhc2UgJ2xpc3QnOlxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5xdWVzdGlvbixcbiAgICAgICAgICAgIHR5cGU6IGRlZmluaXRpb24ubXVsdGlzZWxlY3QgPyAnY2hlY2tib3gnIDogJ2xpc3QnLFxuICAgICAgICAgICAgY2hvaWNlczpcbiAgICAgICAgICAgICAgZGVmaW5pdGlvbi5pdGVtcyAmJlxuICAgICAgICAgICAgICBkZWZpbml0aW9uLml0ZW1zLm1hcCgoaXRlbSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgaXRlbSA9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIGl0ZW07XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGl0ZW0ubGFiZWwsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBpdGVtLnZhbHVlLFxuICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgIH07XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgcmV0dXJuIHsgLi4ucXVlc3Rpb24sIHR5cGU6IGRlZmluaXRpb24udHlwZSB9O1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGlucXVpcmVyLnByb21wdChxdWVzdGlvbnMpO1xuICB9O1xufVxuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbWF4LWxpbmVzLXBlci1mdW5jdGlvblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1haW4oe1xuICBhcmdzLFxuICBzdGRvdXQgPSBwcm9jZXNzLnN0ZG91dCxcbiAgc3RkZXJyID0gcHJvY2Vzcy5zdGRlcnIsXG59OiBNYWluT3B0aW9ucyk6IFByb21pc2U8MCB8IDE+IHtcbiAgY29uc3QgYXJndiA9IHBhcnNlQXJncyhhcmdzKTtcblxuICAvLyBDcmVhdGUgYSBzZXBhcmF0ZSBpbnN0YW5jZSB0byBwcmV2ZW50IHVuaW50ZW5kZWQgZ2xvYmFsIGNoYW5nZXMgdG8gdGhlIGNvbG9yIGNvbmZpZ3VyYXRpb25cbiAgLy8gQ3JlYXRlIGZ1bmN0aW9uIGlzIG5vdCBkZWZpbmVkIGluIHRoZSB0eXBpbmdzLiBTZWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9kb293Yi9hbnNpLWNvbG9ycy9wdWxsLzQ0XG4gIGNvbnN0IGNvbG9ycyA9IChhbnNpQ29sb3JzIGFzIHR5cGVvZiBhbnNpQ29sb3JzICYgeyBjcmVhdGU6ICgpID0+IHR5cGVvZiBhbnNpQ29sb3JzIH0pLmNyZWF0ZSgpO1xuXG4gIC8qKiBDcmVhdGUgdGhlIERldktpdCBMb2dnZXIgdXNlZCB0aHJvdWdoIHRoZSBDTEkuICovXG4gIGNvbnN0IGxvZ2dlciA9IGNyZWF0ZUNvbnNvbGVMb2dnZXIoYXJndlsndmVyYm9zZSddLCBzdGRvdXQsIHN0ZGVyciwge1xuICAgIGluZm86IChzKSA9PiBzLFxuICAgIGRlYnVnOiAocykgPT4gcyxcbiAgICB3YXJuOiAocykgPT4gY29sb3JzLmJvbGQueWVsbG93KHMpLFxuICAgIGVycm9yOiAocykgPT4gY29sb3JzLmJvbGQucmVkKHMpLFxuICAgIGZhdGFsOiAocykgPT4gY29sb3JzLmJvbGQucmVkKHMpLFxuICB9KTtcblxuICBpZiAoYXJndi5oZWxwKSB7XG4gICAgbG9nZ2VyLmluZm8oZ2V0VXNhZ2UoKSk7XG5cbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIC8qKiBHZXQgdGhlIGNvbGxlY3Rpb24gYW4gc2NoZW1hdGljIG5hbWUgZnJvbSB0aGUgZmlyc3QgYXJndW1lbnQuICovXG4gIGNvbnN0IHsgY29sbGVjdGlvbjogY29sbGVjdGlvbk5hbWUsIHNjaGVtYXRpYzogc2NoZW1hdGljTmFtZSB9ID0gcGFyc2VTY2hlbWF0aWNOYW1lKFxuICAgIGFyZ3YuXy5zaGlmdCgpIHx8IG51bGwsXG4gICk7XG5cbiAgY29uc3QgaXNMb2NhbENvbGxlY3Rpb24gPSBjb2xsZWN0aW9uTmFtZS5zdGFydHNXaXRoKCcuJykgfHwgY29sbGVjdGlvbk5hbWUuc3RhcnRzV2l0aCgnLycpO1xuXG4gIC8qKiBHYXRoZXIgdGhlIGFyZ3VtZW50cyBmb3IgbGF0ZXIgdXNlLiAqL1xuICBjb25zdCBkZWJ1Z1ByZXNlbnQgPSBhcmd2WydkZWJ1ZyddICE9PSBudWxsO1xuICBjb25zdCBkZWJ1ZyA9IGRlYnVnUHJlc2VudCA/ICEhYXJndlsnZGVidWcnXSA6IGlzTG9jYWxDb2xsZWN0aW9uO1xuICBjb25zdCBkcnlSdW5QcmVzZW50ID0gYXJndlsnZHJ5LXJ1biddICE9PSBudWxsO1xuICBjb25zdCBkcnlSdW4gPSBkcnlSdW5QcmVzZW50ID8gISFhcmd2WydkcnktcnVuJ10gOiBkZWJ1ZztcbiAgY29uc3QgZm9yY2UgPSBhcmd2Wydmb3JjZSddO1xuICBjb25zdCBhbGxvd1ByaXZhdGUgPSBhcmd2WydhbGxvdy1wcml2YXRlJ107XG5cbiAgLyoqIENyZWF0ZSB0aGUgd29ya2Zsb3cgc2NvcGVkIHRvIHRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGF0IHdpbGwgYmUgZXhlY3V0ZWQgd2l0aCB0aGlzIHJ1bi4gKi9cbiAgY29uc3Qgd29ya2Zsb3cgPSBuZXcgTm9kZVdvcmtmbG93KHByb2Nlc3MuY3dkKCksIHtcbiAgICBmb3JjZSxcbiAgICBkcnlSdW4sXG4gICAgcmVzb2x2ZVBhdGhzOiBbcHJvY2Vzcy5jd2QoKSwgX19kaXJuYW1lXSxcbiAgICBzY2hlbWFWYWxpZGF0aW9uOiB0cnVlLFxuICB9KTtcblxuICAvKiogSWYgdGhlIHVzZXIgd2FudHMgdG8gbGlzdCBzY2hlbWF0aWNzLCB3ZSBzaW1wbHkgc2hvdyBhbGwgdGhlIHNjaGVtYXRpYyBuYW1lcy4gKi9cbiAgaWYgKGFyZ3ZbJ2xpc3Qtc2NoZW1hdGljcyddKSB7XG4gICAgcmV0dXJuIF9saXN0U2NoZW1hdGljcyh3b3JrZmxvdywgY29sbGVjdGlvbk5hbWUsIGxvZ2dlcik7XG4gIH1cblxuICBpZiAoIXNjaGVtYXRpY05hbWUpIHtcbiAgICBsb2dnZXIuaW5mbyhnZXRVc2FnZSgpKTtcblxuICAgIHJldHVybiAxO1xuICB9XG5cbiAgaWYgKGRlYnVnKSB7XG4gICAgbG9nZ2VyLmluZm8oXG4gICAgICBgRGVidWcgbW9kZSBlbmFibGVkJHtpc0xvY2FsQ29sbGVjdGlvbiA/ICcgYnkgZGVmYXVsdCBmb3IgbG9jYWwgY29sbGVjdGlvbnMnIDogJyd9LmAsXG4gICAgKTtcbiAgfVxuXG4gIC8vIEluZGljYXRlIHRvIHRoZSB1c2VyIHdoZW4gbm90aGluZyBoYXMgYmVlbiBkb25lLiBUaGlzIGlzIGF1dG9tYXRpY2FsbHkgc2V0IHRvIG9mZiB3aGVuIHRoZXJlJ3NcbiAgLy8gYSBuZXcgRHJ5UnVuRXZlbnQuXG4gIGxldCBub3RoaW5nRG9uZSA9IHRydWU7XG5cbiAgLy8gTG9nZ2luZyBxdWV1ZSB0aGF0IHJlY2VpdmVzIGFsbCB0aGUgbWVzc2FnZXMgdG8gc2hvdyB0aGUgdXNlcnMuIFRoaXMgb25seSBnZXQgc2hvd24gd2hlbiBub1xuICAvLyBlcnJvcnMgaGFwcGVuZWQuXG4gIGxldCBsb2dnaW5nUXVldWU6IHN0cmluZ1tdID0gW107XG4gIGxldCBlcnJvciA9IGZhbHNlO1xuXG4gIC8qKlxuICAgKiBMb2dzIG91dCBkcnkgcnVuIGV2ZW50cy5cbiAgICpcbiAgICogQWxsIGV2ZW50cyB3aWxsIGFsd2F5cyBiZSBleGVjdXRlZCBoZXJlLCBpbiBvcmRlciBvZiBkaXNjb3ZlcnkuIFRoYXQgbWVhbnMgdGhhdCBhbiBlcnJvciB3b3VsZFxuICAgKiBiZSBzaG93biBhbG9uZyBvdGhlciBldmVudHMgd2hlbiBpdCBoYXBwZW5zLiBTaW5jZSBlcnJvcnMgaW4gd29ya2Zsb3dzIHdpbGwgc3RvcCB0aGUgT2JzZXJ2YWJsZVxuICAgKiBmcm9tIGNvbXBsZXRpbmcgc3VjY2Vzc2Z1bGx5LCB3ZSByZWNvcmQgYW55IGV2ZW50cyBvdGhlciB0aGFuIGVycm9ycywgdGhlbiBvbiBjb21wbGV0aW9uIHdlXG4gICAqIHNob3cgdGhlbS5cbiAgICpcbiAgICogVGhpcyBpcyBhIHNpbXBsZSB3YXkgdG8gb25seSBzaG93IGVycm9ycyB3aGVuIGFuIGVycm9yIG9jY3VyLlxuICAgKi9cbiAgd29ya2Zsb3cucmVwb3J0ZXIuc3Vic2NyaWJlKChldmVudCkgPT4ge1xuICAgIG5vdGhpbmdEb25lID0gZmFsc2U7XG4gICAgLy8gU3RyaXAgbGVhZGluZyBzbGFzaCB0byBwcmV2ZW50IGNvbmZ1c2lvbi5cbiAgICBjb25zdCBldmVudFBhdGggPSBldmVudC5wYXRoLnN0YXJ0c1dpdGgoJy8nKSA/IGV2ZW50LnBhdGguc3Vic3RyKDEpIDogZXZlbnQucGF0aDtcblxuICAgIHN3aXRjaCAoZXZlbnQua2luZCkge1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgICBlcnJvciA9IHRydWU7XG5cbiAgICAgICAgY29uc3QgZGVzYyA9IGV2ZW50LmRlc2NyaXB0aW9uID09ICdhbHJlYWR5RXhpc3QnID8gJ2FscmVhZHkgZXhpc3RzJyA6ICdkb2VzIG5vdCBleGlzdCc7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRVJST1IhICR7ZXZlbnRQYXRofSAke2Rlc2N9LmApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke2NvbG9ycy5jeWFuKCdVUERBVEUnKX0gJHtldmVudFBhdGh9ICgke2V2ZW50LmNvbnRlbnQubGVuZ3RofSBieXRlcylgKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdjcmVhdGUnOlxuICAgICAgICBsb2dnaW5nUXVldWUucHVzaChgJHtjb2xvcnMuZ3JlZW4oJ0NSRUFURScpfSAke2V2ZW50UGF0aH0gKCR7ZXZlbnQuY29udGVudC5sZW5ndGh9IGJ5dGVzKWApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2RlbGV0ZSc6XG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke2NvbG9ycy55ZWxsb3coJ0RFTEVURScpfSAke2V2ZW50UGF0aH1gKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdyZW5hbWUnOlxuICAgICAgICBjb25zdCBldmVudFRvUGF0aCA9IGV2ZW50LnRvLnN0YXJ0c1dpdGgoJy8nKSA/IGV2ZW50LnRvLnN1YnN0cigxKSA6IGV2ZW50LnRvO1xuICAgICAgICBsb2dnaW5nUXVldWUucHVzaChgJHtjb2xvcnMuYmx1ZSgnUkVOQU1FJyl9ICR7ZXZlbnRQYXRofSA9PiAke2V2ZW50VG9QYXRofWApO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH0pO1xuXG4gIC8qKlxuICAgKiBMaXN0ZW4gdG8gbGlmZWN5Y2xlIGV2ZW50cyBvZiB0aGUgd29ya2Zsb3cgdG8gZmx1c2ggdGhlIGxvZ3MgYmV0d2VlbiBlYWNoIHBoYXNlcy5cbiAgICovXG4gIHdvcmtmbG93LmxpZmVDeWNsZS5zdWJzY3JpYmUoKGV2ZW50KSA9PiB7XG4gICAgaWYgKGV2ZW50LmtpbmQgPT0gJ3dvcmtmbG93LWVuZCcgfHwgZXZlbnQua2luZCA9PSAncG9zdC10YXNrcy1zdGFydCcpIHtcbiAgICAgIGlmICghZXJyb3IpIHtcbiAgICAgICAgLy8gRmx1c2ggdGhlIGxvZyBxdWV1ZSBhbmQgY2xlYW4gdGhlIGVycm9yIHN0YXRlLlxuICAgICAgICBsb2dnaW5nUXVldWUuZm9yRWFjaCgobG9nKSA9PiBsb2dnZXIuaW5mbyhsb2cpKTtcbiAgICAgIH1cblxuICAgICAgbG9nZ2luZ1F1ZXVlID0gW107XG4gICAgICBlcnJvciA9IGZhbHNlO1xuICAgIH1cbiAgfSk7XG5cbiAgLyoqXG4gICAqIFJlbW92ZSBldmVyeSBvcHRpb25zIGZyb20gYXJndiB0aGF0IHdlIHN1cHBvcnQgaW4gc2NoZW1hdGljcyBpdHNlbGYuXG4gICAqL1xuICBjb25zdCBwYXJzZWRBcmdzID0gT2JqZWN0LmFzc2lnbih7fSwgYXJndikgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGRlbGV0ZSBwYXJzZWRBcmdzWyctLSddO1xuICBmb3IgKGNvbnN0IGtleSBvZiBib29sZWFuQXJncykge1xuICAgIGRlbGV0ZSBwYXJzZWRBcmdzW2tleV07XG4gIH1cblxuICAvKipcbiAgICogQWRkIG9wdGlvbnMgZnJvbSBgLS1gIHRvIGFyZ3MuXG4gICAqL1xuICBjb25zdCBhcmd2MiA9IG1pbmltaXN0KGFyZ3ZbJy0tJ10pO1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhhcmd2MikpIHtcbiAgICBwYXJzZWRBcmdzW2tleV0gPSBhcmd2MltrZXldO1xuICB9XG5cbiAgLy8gU2hvdyB1c2FnZSBvZiBkZXByZWNhdGVkIG9wdGlvbnNcbiAgd29ya2Zsb3cucmVnaXN0cnkudXNlWERlcHJlY2F0ZWRQcm92aWRlcigobXNnKSA9PiBsb2dnZXIud2Fybihtc2cpKTtcblxuICAvLyBQYXNzIHRoZSByZXN0IG9mIHRoZSBhcmd1bWVudHMgYXMgdGhlIHNtYXJ0IGRlZmF1bHQgXCJhcmd2XCIuIFRoZW4gZGVsZXRlIGl0LlxuICB3b3JrZmxvdy5yZWdpc3RyeS5hZGRTbWFydERlZmF1bHRQcm92aWRlcignYXJndicsIChzY2hlbWEpID0+IHtcbiAgICBpZiAoJ2luZGV4JyBpbiBzY2hlbWEpIHtcbiAgICAgIHJldHVybiBhcmd2Ll9bTnVtYmVyKHNjaGVtYVsnaW5kZXgnXSldO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gYXJndi5fO1xuICAgIH1cbiAgfSk7XG5cbiAgZGVsZXRlIHBhcnNlZEFyZ3MuXztcblxuICAvLyBBZGQgcHJvbXB0cy5cbiAgaWYgKGFyZ3ZbJ2ludGVyYWN0aXZlJ10gJiYgaXNUVFkoKSkge1xuICAgIHdvcmtmbG93LnJlZ2lzdHJ5LnVzZVByb21wdFByb3ZpZGVyKF9jcmVhdGVQcm9tcHRQcm92aWRlcigpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiAgRXhlY3V0ZSB0aGUgd29ya2Zsb3csIHdoaWNoIHdpbGwgcmVwb3J0IHRoZSBkcnkgcnVuIGV2ZW50cywgcnVuIHRoZSB0YXNrcywgYW5kIGNvbXBsZXRlXG4gICAqICBhZnRlciBhbGwgaXMgZG9uZS5cbiAgICpcbiAgICogIFRoZSBPYnNlcnZhYmxlIHJldHVybmVkIHdpbGwgcHJvcGVybHkgY2FuY2VsIHRoZSB3b3JrZmxvdyBpZiB1bnN1YnNjcmliZWQsIGVycm9yIG91dCBpZiBBTllcbiAgICogIHN0ZXAgb2YgdGhlIHdvcmtmbG93IGZhaWxlZCAoc2luayBvciB0YXNrKSwgd2l0aCBkZXRhaWxzIGluY2x1ZGVkLCBhbmQgd2lsbCBvbmx5IGNvbXBsZXRlXG4gICAqICB3aGVuIGV2ZXJ5dGhpbmcgaXMgZG9uZS5cbiAgICovXG4gIHRyeSB7XG4gICAgYXdhaXQgd29ya2Zsb3dcbiAgICAgIC5leGVjdXRlKHtcbiAgICAgICAgY29sbGVjdGlvbjogY29sbGVjdGlvbk5hbWUsXG4gICAgICAgIHNjaGVtYXRpYzogc2NoZW1hdGljTmFtZSxcbiAgICAgICAgb3B0aW9uczogcGFyc2VkQXJncyxcbiAgICAgICAgYWxsb3dQcml2YXRlOiBhbGxvd1ByaXZhdGUsXG4gICAgICAgIGRlYnVnOiBkZWJ1ZyxcbiAgICAgICAgbG9nZ2VyOiBsb2dnZXIsXG4gICAgICB9KVxuICAgICAgLnRvUHJvbWlzZSgpO1xuXG4gICAgaWYgKG5vdGhpbmdEb25lKSB7XG4gICAgICBsb2dnZXIuaW5mbygnTm90aGluZyB0byBiZSBkb25lLicpO1xuICAgIH0gZWxzZSBpZiAoZHJ5UnVuKSB7XG4gICAgICBsb2dnZXIuaW5mbyhcbiAgICAgICAgYERyeSBydW4gZW5hYmxlZCR7XG4gICAgICAgICAgZHJ5UnVuUHJlc2VudCA/ICcnIDogJyBieSBkZWZhdWx0IGluIGRlYnVnIG1vZGUnXG4gICAgICAgIH0uIE5vIGZpbGVzIHdyaXR0ZW4gdG8gZGlzay5gLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gMDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgaWYgKGVyciBpbnN0YW5jZW9mIFVuc3VjY2Vzc2Z1bFdvcmtmbG93RXhlY3V0aW9uKSB7XG4gICAgICAvLyBcIlNlZSBhYm92ZVwiIGJlY2F1c2Ugd2UgYWxyZWFkeSBwcmludGVkIHRoZSBlcnJvci5cbiAgICAgIGxvZ2dlci5mYXRhbCgnVGhlIFNjaGVtYXRpYyB3b3JrZmxvdyBmYWlsZWQuIFNlZSBhYm92ZS4nKTtcbiAgICB9IGVsc2UgaWYgKGRlYnVnKSB7XG4gICAgICBsb2dnZXIuZmF0YWwoJ0FuIGVycm9yIG9jY3VyZWQ6XFxuJyArIGVyci5zdGFjayk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvZ2dlci5mYXRhbChlcnIuc3RhY2sgfHwgZXJyLm1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHJldHVybiAxO1xuICB9XG59XG5cbi8qKlxuICogR2V0IHVzYWdlIG9mIHRoZSBDTEkgdG9vbC5cbiAqL1xuZnVuY3Rpb24gZ2V0VXNhZ2UoKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRhZ3Muc3RyaXBJbmRlbnRgXG4gIHNjaGVtYXRpY3MgW0NvbGxlY3Rpb25OYW1lOl1TY2hlbWF0aWNOYW1lIFtvcHRpb25zLCAuLi5dXG5cbiAgQnkgZGVmYXVsdCwgaWYgdGhlIGNvbGxlY3Rpb24gbmFtZSBpcyBub3Qgc3BlY2lmaWVkLCB1c2UgdGhlIGludGVybmFsIGNvbGxlY3Rpb24gcHJvdmlkZWRcbiAgYnkgdGhlIFNjaGVtYXRpY3MgQ0xJLlxuXG4gIE9wdGlvbnM6XG4gICAgICAtLWRlYnVnICAgICAgICAgICAgIERlYnVnIG1vZGUuIFRoaXMgaXMgdHJ1ZSBieSBkZWZhdWx0IGlmIHRoZSBjb2xsZWN0aW9uIGlzIGEgcmVsYXRpdmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aCAoaW4gdGhhdCBjYXNlLCB0dXJuIG9mZiB3aXRoIC0tZGVidWc9ZmFsc2UpLlxuXG4gICAgICAtLWFsbG93LXByaXZhdGUgICAgIEFsbG93IHByaXZhdGUgc2NoZW1hdGljcyB0byBiZSBydW4gZnJvbSB0aGUgY29tbWFuZCBsaW5lLiBEZWZhdWx0IHRvXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGZhbHNlLlxuXG4gICAgICAtLWRyeS1ydW4gICAgICAgICAgIERvIG5vdCBvdXRwdXQgYW55dGhpbmcsIGJ1dCBpbnN0ZWFkIGp1c3Qgc2hvdyB3aGF0IGFjdGlvbnMgd291bGQgYmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcGVyZm9ybWVkLiBEZWZhdWx0IHRvIHRydWUgaWYgZGVidWcgaXMgYWxzbyB0cnVlLlxuXG4gICAgICAtLWZvcmNlICAgICAgICAgICAgIEZvcmNlIG92ZXJ3cml0aW5nIGZpbGVzIHRoYXQgd291bGQgb3RoZXJ3aXNlIGJlIGFuIGVycm9yLlxuXG4gICAgICAtLWxpc3Qtc2NoZW1hdGljcyAgIExpc3QgYWxsIHNjaGVtYXRpY3MgZnJvbSB0aGUgY29sbGVjdGlvbiwgYnkgbmFtZS4gQSBjb2xsZWN0aW9uIG5hbWVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc2hvdWxkIGJlIHN1ZmZpeGVkIGJ5IGEgY29sb24uIEV4YW1wbGU6ICdAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcy1jbGk6Jy5cblxuICAgICAgLS1uby1pbnRlcmFjdGl2ZSAgICBEaXNhYmxlcyBpbnRlcmFjdGl2ZSBpbnB1dCBwcm9tcHRzLlxuXG4gICAgICAtLXZlcmJvc2UgICAgICAgICAgIFNob3cgbW9yZSBpbmZvcm1hdGlvbi5cblxuICAgICAgLS1oZWxwICAgICAgICAgICAgICBTaG93IHRoaXMgbWVzc2FnZS5cblxuICBBbnkgYWRkaXRpb25hbCBvcHRpb24gaXMgcGFzc2VkIHRvIHRoZSBTY2hlbWF0aWNzIGRlcGVuZGluZyBvbiBpdHMgc2NoZW1hLlxuICBgO1xufVxuXG4vKiogUGFyc2UgdGhlIGNvbW1hbmQgbGluZS4gKi9cbmNvbnN0IGJvb2xlYW5BcmdzID0gW1xuICAnYWxsb3dQcml2YXRlJyxcbiAgJ2FsbG93LXByaXZhdGUnLFxuICAnZGVidWcnLFxuICAnZHJ5LXJ1bicsXG4gICdkcnlSdW4nLFxuICAnZm9yY2UnLFxuICAnaGVscCcsXG4gICdsaXN0LXNjaGVtYXRpY3MnLFxuICAnbGlzdFNjaGVtYXRpY3MnLFxuICAndmVyYm9zZScsXG4gICdpbnRlcmFjdGl2ZScsXG5dO1xuXG5mdW5jdGlvbiBwYXJzZUFyZ3MoYXJnczogc3RyaW5nW10gfCB1bmRlZmluZWQpOiBtaW5pbWlzdC5QYXJzZWRBcmdzIHtcbiAgcmV0dXJuIG1pbmltaXN0KGFyZ3MsIHtcbiAgICBib29sZWFuOiBib29sZWFuQXJncyxcbiAgICBhbGlhczoge1xuICAgICAgJ2RyeVJ1bic6ICdkcnktcnVuJyxcbiAgICAgICdsaXN0U2NoZW1hdGljcyc6ICdsaXN0LXNjaGVtYXRpY3MnLFxuICAgICAgJ2FsbG93UHJpdmF0ZSc6ICdhbGxvdy1wcml2YXRlJyxcbiAgICB9LFxuICAgIGRlZmF1bHQ6IHtcbiAgICAgICdpbnRlcmFjdGl2ZSc6IHRydWUsXG4gICAgICAnZGVidWcnOiBudWxsLFxuICAgICAgJ2RyeVJ1bic6IG51bGwsXG4gICAgfSxcbiAgICAnLS0nOiB0cnVlLFxuICB9KTtcbn1cblxuZnVuY3Rpb24gaXNUVFkoKTogYm9vbGVhbiB7XG4gIGNvbnN0IGlzVHJ1dGh5ID0gKHZhbHVlOiB1bmRlZmluZWQgfCBzdHJpbmcpID0+IHtcbiAgICAvLyBSZXR1cm5zIHRydWUgaWYgdmFsdWUgaXMgYSBzdHJpbmcgdGhhdCBpcyBhbnl0aGluZyBidXQgMCBvciBmYWxzZS5cbiAgICByZXR1cm4gdmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gJzAnICYmIHZhbHVlLnRvVXBwZXJDYXNlKCkgIT09ICdGQUxTRSc7XG4gIH07XG5cbiAgLy8gSWYgd2UgZm9yY2UgVFRZLCB3ZSBhbHdheXMgcmV0dXJuIHRydWUuXG4gIGNvbnN0IGZvcmNlID0gcHJvY2Vzcy5lbnZbJ05HX0ZPUkNFX1RUWSddO1xuICBpZiAoZm9yY2UgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBpc1RydXRoeShmb3JjZSk7XG4gIH1cblxuICByZXR1cm4gISFwcm9jZXNzLnN0ZG91dC5pc1RUWSAmJiAhaXNUcnV0aHkocHJvY2Vzcy5lbnZbJ0NJJ10pO1xufVxuXG5pZiAocmVxdWlyZS5tYWluID09PSBtb2R1bGUpIHtcbiAgY29uc3QgYXJncyA9IHByb2Nlc3MuYXJndi5zbGljZSgyKTtcbiAgbWFpbih7IGFyZ3MgfSlcbiAgICAudGhlbigoZXhpdENvZGUpID0+IChwcm9jZXNzLmV4aXRDb2RlID0gZXhpdENvZGUpKVxuICAgIC5jYXRjaCgoZSkgPT4ge1xuICAgICAgdGhyb3cgZTtcbiAgICB9KTtcbn1cbiJdfQ==