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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2FuZ3VsYXJfZGV2a2l0L3NjaGVtYXRpY3NfY2xpL2Jpbi9zY2hlbWF0aWNzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0E7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILGdDQUFnQztBQUNoQyw2QkFBMkI7QUFDM0IsK0NBQTZEO0FBQzdELG9EQUErRTtBQUMvRSwyREFBMkU7QUFDM0UsNERBQWdFO0FBQ2hFLHdEQUEwQztBQUMxQyxtREFBcUM7QUFDckMsd0RBQWdDO0FBRWhDOzs7Ozs7Ozs7Ozs7O0dBYUc7QUFDSCxTQUFTLGtCQUFrQixDQUFDLEdBQWtCO0lBQzVDLElBQUksVUFBVSxHQUFHLGdDQUFnQyxDQUFDO0lBRWxELElBQUksU0FBUyxHQUFHLEdBQUcsQ0FBQztJQUNwQixJQUFJLFNBQVMsSUFBSSxTQUFTLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFO1FBQzdDLENBQUMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxHQUFHO1lBQ3hCLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDOUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztTQUNwRCxDQUFDO0tBQ0g7SUFFRCxPQUFPLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxDQUFDO0FBQ25DLENBQUM7QUFRRCxTQUFTLGVBQWUsQ0FBQyxRQUFzQixFQUFFLGNBQXNCLEVBQUUsTUFBc0I7SUFDN0YsSUFBSTtRQUNGLE1BQU0sVUFBVSxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDcEUsTUFBTSxDQUFD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RSxPQUFPLEtBQUssS0FBSyxTQUFTLElBQUksS0FBSyxLQUFLLEdBQUcsSUFBSSxLQUFLLENBQUMsV0FBVyxFQUFFLEtBQUssT0FBTyxDQUFDO0lBQ2pGLENBQUMsQ0FBQztJQUVGLDBDQUEwQztJQUMxQyxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxDQUFDO0lBQzFDLElBQUksS0FBSyxLQUFLLFNBQVMsRUFBRTtRQUN2QixPQUFPLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQztLQUN4QjtJQUVELE9BQU8sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsS0FBSyxJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUNoRSxDQUFDO0FBRUQsSUFBSSxPQUFPLENBQUMsSUFBSSxLQUFLLE1BQU0sRUFBRTtJQUMzQixNQUFNLElBQUksR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNuQyxJQUFJLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQztTQUNYLElBQUksQ0FBQyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQyxDQUFDO1NBQ2pELEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFO1FBQ1gsTUFBTSxDQUFDLENBQUM7SUFDVixDQUFDLENBQUMsQ0FBQztDQUNOIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbi8vIHN5bWJvbCBwb2x5ZmlsbCBtdXN0IGdvIGZpcnN0XG5pbXBvcnQgJ3N5bWJvbC1vYnNlcnZhYmxlJztcbmltcG9ydCB7IGxvZ2dpbmcsIHNjaGVtYSwgdGFncyB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlJztcbmltcG9ydCB7IFByb2Nlc3NPdXRwdXQsIGNyZWF0ZUNvbnNvbGVMb2dnZXIgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZS9ub2RlJztcbmltcG9ydCB7IFVuc3VjY2Vzc2Z1bFdvcmtmbG93RXhlY3V0aW9uIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MnO1xuaW1wb3J0IHsgTm9kZVdvcmtmbG93IH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MvdG9vbHMnO1xuaW1wb3J0ICogYXMgYW5zaUNvbG9ycyBmcm9tICdhbnNpLWNvbG9ycyc7XG5pbXBvcnQgKiBhcyBpbnF1aXJlciBmcm9tICdpbnF1aXJlcic7XG5pbXBvcnQgbWluaW1pc3QgZnJvbSAnbWluaW1pc3QnO1xuXG4vKipcbiAqIFBhcnNlIHRoZSBuYW1lIG9mIHNjaGVtYXRpYyBwYXNzZWQgaW4gYXJndW1lbnQsIGFuZCByZXR1cm4gYSB7Y29sbGVjdGlvbiwgc2NoZW1hdGljfSBuYW1lZFxuICogdHVwbGUuIFRoZSB1c2VyIGNhbiBwYXNzIGluIGBjb2xsZWN0aW9uLW5hbWU6c2NoZW1hdGljLW5hbWVgLCBhbmQgdGhpcyBmdW5jdGlvbiB3aWxsIGVpdGhlclxuICogcmV0dXJuIGB7Y29sbGVjdGlvbjogJ2NvbGxlY3Rpb24tbmFtZScsIHNjaGVtYXRpYzogJ3NjaGVtYXRpYy1uYW1lJ31gLCBvciBpdCB3aWxsIGVycm9yIG91dFxuICogYW5kIHNob3cgdXNhZ2UuXG4gKlxuICogSW4gdGhlIGNhc2Ugd2hlcmUgYSBjb2xsZWN0aW9uIG5hbWUgaXNuJ3QgcGFydCBvZiB0aGUgYXJndW1lbnQsIHRoZSBkZWZhdWx0IGlzIHRvIHVzZSB0aGVcbiAqIHNjaGVtYXRpY3MgcGFja2FnZSAoQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MtY2xpKSBhcyB0aGUgY29sbGVjdGlvbi5cbiAqXG4gKiBUaGlzIGxvZ2ljIGlzIGVudGlyZWx5IHVwIHRvIHRoZSB0b29saW5nLlxuICpcbiAqIEBwYXJhbSBzdHIgVGhlIGFyZ3VtZW50IHRvIHBhcnNlLlxuICogQHJldHVybiB7e2NvbGxlY3Rpb246IHN0cmluZywgc2NoZW1hdGljOiAoc3RyaW5nKX19XG4gKi9cbmZ1bmN0aW9uIHBhcnNlU2NoZW1hdGljTmFtZShzdHI6IHN0cmluZyB8IG51bGwpOiB7IGNvbGxlY3Rpb246IHN0cmluZzsgc2NoZW1hdGljOiBzdHJpbmcgfCBudWxsIH0ge1xuICBsZXQgY29sbGVjdGlvbiA9ICdAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcy1jbGknO1xuXG4gIGxldCBzY2hlbWF0aWMgPSBzdHI7XG4gIGlmIChzY2hlbWF0aWMgJiYgc2NoZW1hdGljLmluZGV4T2YoJzonKSAhPSAtMSkge1xuICAgIFtjb2xsZWN0aW9uLCBzY2hlbWF0aWNdID0gW1xuICAgICAgc2NoZW1hdGljLnNsaWNlKDAsIHNjaGVtYXRpYy5sYXN0SW5kZXhPZignOicpKSxcbiAgICAgIHNjaGVtYXRpYy5zdWJzdHJpbmcoc2NoZW1hdGljLmxhc3RJbmRleE9mKCc6JykgKyAxKSxcbiAgICBdO1xuICB9XG5cbiAgcmV0dXJuIHsgY29sbGVjdGlvbiwgc2NoZW1hdGljIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWFpbk9wdGlvbnMge1xuICBhcmdzOiBzdHJpbmdbXTtcbiAgc3Rkb3V0PzogUHJvY2Vzc091dHB1dDtcbiAgc3RkZXJyPzogUHJvY2Vzc091dHB1dDtcbn1cblxuZnVuY3Rpb24gX2xpc3RTY2hlbWF0aWNzKHdvcmtmbG93OiBOb2RlV29ya2Zsb3csIGNvbGxlY3Rpb25OYW1lOiBzdHJpbmcsIGxvZ2dlcjogbG9nZ2luZy5Mb2dnZXIpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb2xsZWN0aW9uID0gd29ya2Zsb3cuZW5naW5lLmNyZWF0ZUNvbGxlY3Rpb24oY29sbGVjdGlvbk5hbWUpO1xuICAgIGxvZ2dlci5pbmZvKGNvbGxlY3Rpb24ubGlzdFNjaGVtYXRpY05hbWVzKCkuam9pbignXFxuJykpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5mYXRhbChlcnJvci5tZXNzYWdlKTtcblxuICAgIHJldHVybiAxO1xuICB9XG5cbiAgcmV0dXJuIDA7XG59XG5cbmZ1bmN0aW9uIF9jcmVhdGVQcm9tcHRQcm92aWRlcigpOiBzY2hlbWEuUHJvbXB0UHJvdmlkZXIge1xuICByZXR1cm4gKGRlZmluaXRpb25zKSA9PiB7XG4gICAgY29uc3QgcXVlc3Rpb25zOiBpbnF1aXJlci5RdWVzdGlvbkNvbGxlY3Rpb24gPSBkZWZpbml0aW9ucy5tYXAoKGRlZmluaXRpb24pID0+IHtcbiAgICAgIGNvbnN0IHF1ZXN0aW9uOiBpbnF1aXJlci5RdWVzdGlvbiA9IHtcbiAgICAgICAgbmFtZTogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgbWVzc2FnZTogZGVmaW5pdGlvbi5tZXNzYWdlLFxuICAgICAgICBkZWZhdWx0OiBkZWZpbml0aW9uLmRlZmF1bHQsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBkZWZpbml0aW9uLnZhbGlkYXRvcjtcbiAgICAgIGlmICh2YWxpZGF0b3IpIHtcbiAgICAgICAgcXVlc3Rpb24udmFsaWRhdGUgPSAoaW5wdXQpID0+IHZhbGlkYXRvcihpbnB1dCk7XG4gICAgICB9XG5cbiAgICAgIHN3aXRjaCAoZGVmaW5pdGlvbi50eXBlKSB7XG4gICAgICAgIGNhc2UgJ2NvbmZpcm1hdGlvbic6XG4gICAgICAgICAgcmV0dXJuIHsgLi4ucXVlc3Rpb24sIHR5cGU6ICdjb25maXJtJyB9O1xuICAgICAgICBjYXNlICdsaXN0JzpcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4ucXVlc3Rpb24sXG4gICAgICAgICAgICB0eXBlOiBkZWZpbml0aW9uLm11bHRpc2VsZWN0ID8gJ2NoZWNrYm94JyA6ICdsaXN0JyxcbiAgICAgICAgICAgIGNob2ljZXM6XG4gICAgICAgICAgICAgIGRlZmluaXRpb24uaXRlbXMgJiZcbiAgICAgICAgICAgICAgZGVmaW5pdGlvbi5pdGVtcy5tYXAoKGl0ZW0pID0+IHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGl0ZW0gPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBpdGVtO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBpdGVtLmxhYmVsLFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZTogaXRlbS52YWx1ZSxcbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICB9O1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHJldHVybiB7IC4uLnF1ZXN0aW9uLCB0eXBlOiBkZWZpbml0aW9uLnR5cGUgfTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBpbnF1aXJlci5wcm9tcHQocXVlc3Rpb25zKTtcbiAgfTtcbn1cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG1heC1saW5lcy1wZXItZnVuY3Rpb25cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYWluKHtcbiAgYXJncyxcbiAgc3Rkb3V0ID0gcHJvY2Vzcy5zdGRvdXQsXG4gIHN0ZGVyciA9IHByb2Nlc3Muc3RkZXJyLFxufTogTWFpbk9wdGlvbnMpOiBQcm9taXNlPDAgfCAxPiB7XG4gIGNvbnN0IGFyZ3YgPSBwYXJzZUFyZ3MoYXJncyk7XG5cbiAgLy8gQ3JlYXRlIGEgc2VwYXJhdGUgaW5zdGFuY2UgdG8gcHJldmVudCB1bmludGVuZGVkIGdsb2JhbCBjaGFuZ2VzIHRvIHRoZSBjb2xvciBjb25maWd1cmF0aW9uXG4gIC8vIENyZWF0ZSBmdW5jdGlvbiBpcyBub3QgZGVmaW5lZCBpbiB0aGUgdHlwaW5ncy4gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vZG9vd2IvYW5zaS1jb2xvcnMvcHVsbC80NFxuICBjb25zdCBjb2xvcnMgPSAoYW5zaUNvbG9ycyBhcyB0eXBlb2YgYW5zaUNvbG9ycyAmIHsgY3JlYXRlOiAoKSA9PiB0eXBlb2YgYW5zaUNvbG9ycyB9KS5jcmVhdGUoKTtcblxuICAvKiogQ3JlYXRlIHRoZSBEZXZLaXQgTG9nZ2VyIHVzZWQgdGhyb3VnaCB0aGUgQ0xJLiAqL1xuICBjb25zdCBsb2dnZXIgPSBjcmVhdGVDb25zb2xlTG9nZ2VyKGFyZ3ZbJ3ZlcmJvc2UnXSwgc3Rkb3V0LCBzdGRlcnIsIHtcbiAgICBpbmZvOiAocykgPT4gcyxcbiAgICBkZWJ1ZzogKHMpID0+IHMsXG4gICAgd2FybjogKHMpID0+IGNvbG9ycy5ib2xkLnllbGxvdyhzKSxcbiAgICBlcnJvcjogKHMpID0+IGNvbG9ycy5ib2xkLnJlZChzKSxcbiAgICBmYXRhbDogKHMpID0+IGNvbG9ycy5ib2xkLnJlZChzKSxcbiAgfSk7XG5cbiAgaWYgKGFyZ3YuaGVscCkge1xuICAgIGxvZ2dlci5pbmZvKGdldFVzYWdlKCkpO1xuXG4gICAgcmV0dXJuIDA7XG4gIH1cblxuICAvKiogR2V0IHRoZSBjb2xsZWN0aW9uIGFuIHNjaGVtYXRpYyBuYW1lIGZyb20gdGhlIGZpcnN0IGFyZ3VtZW50LiAqL1xuICBjb25zdCB7IGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLCBzY2hlbWF0aWM6IHNjaGVtYXRpY05hbWUgfSA9IHBhcnNlU2NoZW1hdGljTmFtZShcbiAgICBhcmd2Ll8uc2hpZnQoKSB8fCBudWxsLFxuICApO1xuXG4gIGNvbnN0IGlzTG9jYWxDb2xsZWN0aW9uID0gY29sbGVjdGlvbk5hbWUuc3RhcnRzV2l0aCgnLicpIHx8IGNvbGxlY3Rpb25OYW1lLnN0YXJ0c1dpdGgoJy8nKTtcblxuICAvKiogR2F0aGVyIHRoZSBhcmd1bWVudHMgZm9yIGxhdGVyIHVzZS4gKi9cbiAgY29uc3QgZGVidWdQcmVzZW50ID0gYXJndlsnZGVidWcnXSAhPT0gbnVsbDtcbiAgY29uc3QgZGVidWcgPSBkZWJ1Z1ByZXNlbnQgPyAhIWFyZ3ZbJ2RlYnVnJ10gOiBpc0xvY2FsQ29sbGVjdGlvbjtcbiAgY29uc3QgZHJ5UnVuUHJlc2VudCA9IGFyZ3ZbJ2RyeS1ydW4nXSAhPT0gbnVsbDtcbiAgY29uc3QgZHJ5UnVuID0gZHJ5UnVuUHJlc2VudCA/ICEhYXJndlsnZHJ5LXJ1biddIDogZGVidWc7XG4gIGNvbnN0IGZvcmNlID0gYXJndlsnZm9yY2UnXTtcbiAgY29uc3QgYWxsb3dQcml2YXRlID0gYXJndlsnYWxsb3ctcHJpdmF0ZSddO1xuXG4gIC8qKiBDcmVhdGUgdGhlIHdvcmtmbG93IHNjb3BlZCB0byB0aGUgd29ya2luZyBkaXJlY3RvcnkgdGhhdCB3aWxsIGJlIGV4ZWN1dGVkIHdpdGggdGhpcyBydW4uICovXG4gIGNvbnN0IHdvcmtmbG93ID0gbmV3IE5vZGVXb3JrZmxvdyhwcm9jZXNzLmN3ZCgpLCB7XG4gICAgZm9yY2UsXG4gICAgZHJ5UnVuLFxuICAgIHJlc29sdmVQYXRoczogW3Byb2Nlc3MuY3dkKCksIF9fZGlybmFtZV0sXG4gICAgc2NoZW1hVmFsaWRhdGlvbjogdHJ1ZSxcbiAgfSk7XG5cbiAgLyoqIElmIHRoZSB1c2VyIHdhbnRzIHRvIGxpc3Qgc2NoZW1hdGljcywgd2Ugc2ltcGx5IHNob3cgYWxsIHRoZSBzY2hlbWF0aWMgbmFtZXMuICovXG4gIGlmIChhcmd2WydsaXN0LXNjaGVtYXRpY3MnXSkge1xuICAgIHJldHVybiBfbGlzdFNjaGVtYXRpY3Mod29ya2Zsb3csIGNvbGxlY3Rpb25OYW1lLCBsb2dnZXIpO1xuICB9XG5cbiAgaWYgKCFzY2hlbWF0aWNOYW1lKSB7XG4gICAgbG9nZ2VyLmluZm8oZ2V0VXNhZ2UoKSk7XG5cbiAgICByZXR1cm4gMTtcbiAgfVxuXG4gIGlmIChkZWJ1Zykge1xuICAgIGxvZ2dlci5pbmZvKFxuICAgICAgYERlYnVnIG1vZGUgZW5hYmxlZCR7aXNMb2NhbENvbGxlY3Rpb24gPyAnIGJ5IGRlZmF1bHQgZm9yIGxvY2FsIGNvbGxlY3Rpb25zJyA6ICcnfS5gLFxuICAgICk7XG4gIH1cblxuICAvLyBJbmRpY2F0ZSB0byB0aGUgdXNlciB3aGVuIG5vdGhpbmcgaGFzIGJlZW4gZG9uZS4gVGhpcyBpcyBhdXRvbWF0aWNhbGx5IHNldCB0byBvZmYgd2hlbiB0aGVyZSdzXG4gIC8vIGEgbmV3IERyeVJ1bkV2ZW50LlxuICBsZXQgbm90aGluZ0RvbmUgPSB0cnVlO1xuXG4gIC8vIExvZ2dpbmcgcXVldWUgdGhhdCByZWNlaXZlcyBhbGwgdGhlIG1lc3NhZ2VzIHRvIHNob3cgdGhlIHVzZXJzLiBUaGlzIG9ubHkgZ2V0IHNob3duIHdoZW4gbm9cbiAgLy8gZXJyb3JzIGhhcHBlbmVkLlxuICBsZXQgbG9nZ2luZ1F1ZXVlOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgZXJyb3IgPSBmYWxzZTtcblxuICAvKipcbiAgICogTG9ncyBvdXQgZHJ5IHJ1biBldmVudHMuXG4gICAqXG4gICAqIEFsbCBldmVudHMgd2lsbCBhbHdheXMgYmUgZXhlY3V0ZWQgaGVyZSwgaW4gb3JkZXIgb2YgZGlzY292ZXJ5LiBUaGF0IG1lYW5zIHRoYXQgYW4gZXJyb3Igd291bGRcbiAgICogYmUgc2hvd24gYWxvbmcgb3RoZXIgZXZlbnRzIHdoZW4gaXQgaGFwcGVucy4gU2luY2UgZXJyb3JzIGluIHdvcmtmbG93cyB3aWxsIHN0b3AgdGhlIE9ic2VydmFibGVcbiAgICogZnJvbSBjb21wbGV0aW5nIHN1Y2Nlc3NmdWxseSwgd2UgcmVjb3JkIGFueSBldmVudHMgb3RoZXIgdGhhbiBlcnJvcnMsIHRoZW4gb24gY29tcGxldGlvbiB3ZVxuICAgKiBzaG93IHRoZW0uXG4gICAqXG4gICAqIFRoaXMgaXMgYSBzaW1wbGUgd2F5IHRvIG9ubHkgc2hvdyBlcnJvcnMgd2hlbiBhbiBlcnJvciBvY2N1ci5cbiAgICovXG4gIHdvcmtmbG93LnJlcG9ydGVyLnN1YnNjcmliZSgoZXZlbnQpID0+IHtcbiAgICBub3RoaW5nRG9uZSA9IGZhbHNlO1xuICAgIC8vIFN0cmlwIGxlYWRpbmcgc2xhc2ggdG8gcHJldmVudCBjb25mdXNpb24uXG4gICAgY29uc3QgZXZlbnRQYXRoID0gZXZlbnQucGF0aC5zdGFydHNXaXRoKCcvJykgPyBldmVudC5wYXRoLnN1YnN0cigxKSA6IGV2ZW50LnBhdGg7XG5cbiAgICBzd2l0Y2ggKGV2ZW50LmtpbmQpIHtcbiAgICAgIGNhc2UgJ2Vycm9yJzpcbiAgICAgICAgZXJyb3IgPSB0cnVlO1xuXG4gICAgICAgIGNvbnN0IGRlc2MgPSBldmVudC5kZXNjcmlwdGlvbiA9PSAnYWxyZWFkeUV4aXN0JyA/ICdhbHJlYWR5IGV4aXN0cycgOiAnZG9lcyBub3QgZXhpc3QnO1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEVSUk9SISAke2V2ZW50UGF0aH0gJHtkZXNjfS5gKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd1cGRhdGUnOlxuICAgICAgICBsb2dnaW5nUXVldWUucHVzaChgJHtjb2xvcnMuY3lhbignVVBEQVRFJyl9ICR7ZXZlbnRQYXRofSAoJHtldmVudC5jb250ZW50Lmxlbmd0aH0gYnl0ZXMpYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7Y29sb3JzLmdyZWVuKCdDUkVBVEUnKX0gJHtldmVudFBhdGh9ICgke2V2ZW50LmNvbnRlbnQubGVuZ3RofSBieXRlcylgKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdkZWxldGUnOlxuICAgICAgICBsb2dnaW5nUXVldWUucHVzaChgJHtjb2xvcnMueWVsbG93KCdERUxFVEUnKX0gJHtldmVudFBhdGh9YCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAncmVuYW1lJzpcbiAgICAgICAgY29uc3QgZXZlbnRUb1BhdGggPSBldmVudC50by5zdGFydHNXaXRoKCcvJykgPyBldmVudC50by5zdWJzdHIoMSkgOiBldmVudC50bztcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7Y29sb3JzLmJsdWUoJ1JFTkFNRScpfSAke2V2ZW50UGF0aH0gPT4gJHtldmVudFRvUGF0aH1gKTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9KTtcblxuICAvKipcbiAgICogTGlzdGVuIHRvIGxpZmVjeWNsZSBldmVudHMgb2YgdGhlIHdvcmtmbG93IHRvIGZsdXNoIHRoZSBsb2dzIGJldHdlZW4gZWFjaCBwaGFzZXMuXG4gICAqL1xuICB3b3JrZmxvdy5saWZlQ3ljbGUuc3Vic2NyaWJlKChldmVudCkgPT4ge1xuICAgIGlmIChldmVudC5raW5kID09ICd3b3JrZmxvdy1lbmQnIHx8IGV2ZW50LmtpbmQgPT0gJ3Bvc3QtdGFza3Mtc3RhcnQnKSB7XG4gICAgICBpZiAoIWVycm9yKSB7XG4gICAgICAgIC8vIEZsdXNoIHRoZSBsb2cgcXVldWUgYW5kIGNsZWFuIHRoZSBlcnJvciBzdGF0ZS5cbiAgICAgICAgbG9nZ2luZ1F1ZXVlLmZvckVhY2goKGxvZykgPT4gbG9nZ2VyLmluZm8obG9nKSk7XG4gICAgICB9XG5cbiAgICAgIGxvZ2dpbmdRdWV1ZSA9IFtdO1xuICAgICAgZXJyb3IgPSBmYWxzZTtcbiAgICB9XG4gIH0pO1xuXG4gIC8qKlxuICAgKiBSZW1vdmUgZXZlcnkgb3B0aW9ucyBmcm9tIGFyZ3YgdGhhdCB3ZSBzdXBwb3J0IGluIHNjaGVtYXRpY3MgaXRzZWxmLlxuICAgKi9cbiAgY29uc3QgcGFyc2VkQXJncyA9IE9iamVjdC5hc3NpZ24oe30sIGFyZ3YpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBkZWxldGUgcGFyc2VkQXJnc1snLS0nXTtcbiAgZm9yIChjb25zdCBrZXkgb2YgYm9vbGVhbkFyZ3MpIHtcbiAgICBkZWxldGUgcGFyc2VkQXJnc1trZXldO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZCBvcHRpb25zIGZyb20gYC0tYCB0byBhcmdzLlxuICAgKi9cbiAgY29uc3QgYXJndjIgPSBtaW5pbWlzdChhcmd2WyctLSddKTtcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoYXJndjIpKSB7XG4gICAgcGFyc2VkQXJnc1trZXldID0gYXJndjJba2V5XTtcbiAgfVxuXG4gIC8vIFNob3cgdXNhZ2Ugb2YgZGVwcmVjYXRlZCBvcHRpb25zXG4gIHdvcmtmbG93LnJlZ2lzdHJ5LnVzZVhEZXByZWNhdGVkUHJvdmlkZXIoKG1zZykgPT4gbG9nZ2VyLndhcm4obXNnKSk7XG5cbiAgLy8gUGFzcyB0aGUgcmVzdCBvZiB0aGUgYXJndW1lbnRzIGFzIHRoZSBzbWFydCBkZWZhdWx0IFwiYXJndlwiLiBUaGVuIGRlbGV0ZSBpdC5cbiAgd29ya2Zsb3cucmVnaXN0cnkuYWRkU21hcnREZWZhdWx0UHJvdmlkZXIoJ2FyZ3YnLCAoc2NoZW1hKSA9PiB7XG4gICAgaWYgKCdpbmRleCcgaW4gc2NoZW1hKSB7XG4gICAgICByZXR1cm4gYXJndi5fW051bWJlcihzY2hlbWFbJ2luZGV4J10pXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGFyZ3YuXztcbiAgICB9XG4gIH0pO1xuXG4gIGRlbGV0ZSBwYXJzZWRBcmdzLl87XG5cbiAgLy8gQWRkIHByb21wdHMuXG4gIGlmIChhcmd2WydpbnRlcmFjdGl2ZSddICYmIGlzVFRZKCkpIHtcbiAgICB3b3JrZmxvdy5yZWdpc3RyeS51c2VQcm9tcHRQcm92aWRlcihfY3JlYXRlUHJvbXB0UHJvdmlkZXIoKSk7XG4gIH1cblxuICAvKipcbiAgICogIEV4ZWN1dGUgdGhlIHdvcmtmbG93LCB3aGljaCB3aWxsIHJlcG9ydCB0aGUgZHJ5IHJ1biBldmVudHMsIHJ1biB0aGUgdGFza3MsIGFuZCBjb21wbGV0ZVxuICAgKiAgYWZ0ZXIgYWxsIGlzIGRvbmUuXG4gICAqXG4gICAqICBUaGUgT2JzZXJ2YWJsZSByZXR1cm5lZCB3aWxsIHByb3Blcmx5IGNhbmNlbCB0aGUgd29ya2Zsb3cgaWYgdW5zdWJzY3JpYmVkLCBlcnJvciBvdXQgaWYgQU5ZXG4gICAqICBzdGVwIG9mIHRoZSB3b3JrZmxvdyBmYWlsZWQgKHNpbmsgb3IgdGFzayksIHdpdGggZGV0YWlscyBpbmNsdWRlZCwgYW5kIHdpbGwgb25seSBjb21wbGV0ZVxuICAgKiAgd2hlbiBldmVyeXRoaW5nIGlzIGRvbmUuXG4gICAqL1xuICB0cnkge1xuICAgIGF3YWl0IHdvcmtmbG93XG4gICAgICAuZXhlY3V0ZSh7XG4gICAgICAgIGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLFxuICAgICAgICBzY2hlbWF0aWM6IHNjaGVtYXRpY05hbWUsXG4gICAgICAgIG9wdGlvbnM6IHBhcnNlZEFyZ3MsXG4gICAgICAgIGFsbG93UHJpdmF0ZTogYWxsb3dQcml2YXRlLFxuICAgICAgICBkZWJ1ZzogZGVidWcsXG4gICAgICAgIGxvZ2dlcjogbG9nZ2VyLFxuICAgICAgfSlcbiAgICAgIC50b1Byb21pc2UoKTtcblxuICAgIGlmIChub3RoaW5nRG9uZSkge1xuICAgICAgbG9nZ2VyLmluZm8oJ05vdGhpbmcgdG8gYmUgZG9uZS4nKTtcbiAgICB9IGVsc2UgaWYgKGRyeVJ1bikge1xuICAgICAgbG9nZ2VyLmluZm8oXG4gICAgICAgIGBEcnkgcnVuIGVuYWJsZWQke1xuICAgICAgICAgIGRyeVJ1blByZXNlbnQgPyAnJyA6ICcgYnkgZGVmYXVsdCBpbiBkZWJ1ZyBtb2RlJ1xuICAgICAgICB9LiBObyBmaWxlcyB3cml0dGVuIHRvIGRpc2suYCxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIDA7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBVbnN1Y2Nlc3NmdWxXb3JrZmxvd0V4ZWN1dGlvbikge1xuICAgICAgLy8gXCJTZWUgYWJvdmVcIiBiZWNhdXNlIHdlIGFscmVhZHkgcHJpbnRlZCB0aGUgZXJyb3IuXG4gICAgICBsb2dnZXIuZmF0YWwoJ1RoZSBTY2hlbWF0aWMgd29ya2Zsb3cgZmFpbGVkLiBTZWUgYWJvdmUuJyk7XG4gICAgfSBlbHNlIGlmIChkZWJ1Zykge1xuICAgICAgbG9nZ2VyLmZhdGFsKCdBbiBlcnJvciBvY2N1cmVkOlxcbicgKyBlcnIuc3RhY2spO1xuICAgIH0gZWxzZSB7XG4gICAgICBsb2dnZXIuZmF0YWwoZXJyLnN0YWNrIHx8IGVyci5tZXNzYWdlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gMTtcbiAgfVxufVxuXG4vKipcbiAqIEdldCB1c2FnZSBvZiB0aGUgQ0xJIHRvb2wuXG4gKi9cbmZ1bmN0aW9uIGdldFVzYWdlKCk6IHN0cmluZyB7XG4gIHJldHVybiB0YWdzLnN0cmlwSW5kZW50YFxuICBzY2hlbWF0aWNzIFtDb2xsZWN0aW9uTmFtZTpdU2NoZW1hdGljTmFtZSBbb3B0aW9ucywgLi4uXVxuXG4gIEJ5IGRlZmF1bHQsIGlmIHRoZSBjb2xsZWN0aW9uIG5hbWUgaXMgbm90IHNwZWNpZmllZCwgdXNlIHRoZSBpbnRlcm5hbCBjb2xsZWN0aW9uIHByb3ZpZGVkXG4gIGJ5IHRoZSBTY2hlbWF0aWNzIENMSS5cblxuICBPcHRpb25zOlxuICAgICAgLS1kZWJ1ZyAgICAgICAgICAgICBEZWJ1ZyBtb2RlLiBUaGlzIGlzIHRydWUgYnkgZGVmYXVsdCBpZiB0aGUgY29sbGVjdGlvbiBpcyBhIHJlbGF0aXZlXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGggKGluIHRoYXQgY2FzZSwgdHVybiBvZmYgd2l0aCAtLWRlYnVnPWZhbHNlKS5cblxuICAgICAgLS1hbGxvdy1wcml2YXRlICAgICBBbGxvdyBwcml2YXRlIHNjaGVtYXRpY3MgdG8gYmUgcnVuIGZyb20gdGhlIGNvbW1hbmQgbGluZS4gRGVmYXVsdCB0b1xuICAgICAgICAgICAgICAgICAgICAgICAgICBmYWxzZS5cblxuICAgICAgLS1kcnktcnVuICAgICAgICAgICBEbyBub3Qgb3V0cHV0IGFueXRoaW5nLCBidXQgaW5zdGVhZCBqdXN0IHNob3cgd2hhdCBhY3Rpb25zIHdvdWxkIGJlXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHBlcmZvcm1lZC4gRGVmYXVsdCB0byB0cnVlIGlmIGRlYnVnIGlzIGFsc28gdHJ1ZS5cblxuICAgICAgLS1mb3JjZSAgICAgICAgICAgICBGb3JjZSBvdmVyd3JpdGluZyBmaWxlcyB0aGF0IHdvdWxkIG90aGVyd2lzZSBiZSBhbiBlcnJvci5cblxuICAgICAgLS1saXN0LXNjaGVtYXRpY3MgICBMaXN0IGFsbCBzY2hlbWF0aWNzIGZyb20gdGhlIGNvbGxlY3Rpb24sIGJ5IG5hbWUuIEEgY29sbGVjdGlvbiBuYW1lXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHNob3VsZCBiZSBzdWZmaXhlZCBieSBhIGNvbG9uLiBFeGFtcGxlOiAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MtY2xpOicuXG5cbiAgICAgIC0tbm8taW50ZXJhY3RpdmUgICAgRGlzYWJsZXMgaW50ZXJhY3RpdmUgaW5wdXQgcHJvbXB0cy5cblxuICAgICAgLS12ZXJib3NlICAgICAgICAgICBTaG93IG1vcmUgaW5mb3JtYXRpb24uXG5cbiAgICAgIC0taGVscCAgICAgICAgICAgICAgU2hvdyB0aGlzIG1lc3NhZ2UuXG5cbiAgQW55IGFkZGl0aW9uYWwgb3B0aW9uIGlzIHBhc3NlZCB0byB0aGUgU2NoZW1hdGljcyBkZXBlbmRpbmcgb24gaXRzIHNjaGVtYS5cbiAgYDtcbn1cblxuLyoqIFBhcnNlIHRoZSBjb21tYW5kIGxpbmUuICovXG5jb25zdCBib29sZWFuQXJncyA9IFtcbiAgJ2FsbG93UHJpdmF0ZScsXG4gICdhbGxvdy1wcml2YXRlJyxcbiAgJ2RlYnVnJyxcbiAgJ2RyeS1ydW4nLFxuICAnZHJ5UnVuJyxcbiAgJ2ZvcmNlJyxcbiAgJ2hlbHAnLFxuICAnbGlzdC1zY2hlbWF0aWNzJyxcbiAgJ2xpc3RTY2hlbWF0aWNzJyxcbiAgJ3ZlcmJvc2UnLFxuICAnaW50ZXJhY3RpdmUnLFxuXTtcblxuZnVuY3Rpb24gcGFyc2VBcmdzKGFyZ3M6IHN0cmluZ1tdIHwgdW5kZWZpbmVkKTogbWluaW1pc3QuUGFyc2VkQXJncyB7XG4gIHJldHVybiBtaW5pbWlzdChhcmdzLCB7XG4gICAgYm9vbGVhbjogYm9vbGVhbkFyZ3MsXG4gICAgYWxpYXM6IHtcbiAgICAgICdkcnlSdW4nOiAnZHJ5LXJ1bicsXG4gICAgICAnbGlzdFNjaGVtYXRpY3MnOiAnbGlzdC1zY2hlbWF0aWNzJyxcbiAgICAgICdhbGxvd1ByaXZhdGUnOiAnYWxsb3ctcHJpdmF0ZScsXG4gICAgfSxcbiAgICBkZWZhdWx0OiB7XG4gICAgICAnaW50ZXJhY3RpdmUnOiB0cnVlLFxuICAgICAgJ2RlYnVnJzogbnVsbCxcbiAgICAgICdkcnlSdW4nOiBudWxsLFxuICAgIH0sXG4gICAgJy0tJzogdHJ1ZSxcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGlzVFRZKCk6IGJvb2xlYW4ge1xuICBjb25zdCBpc1RydXRoeSA9ICh2YWx1ZTogdW5kZWZpbmVkIHwgc3RyaW5nKSA9PiB7XG4gICAgLy8gUmV0dXJucyB0cnVlIGlmIHZhbHVlIGlzIGEgc3RyaW5nIHRoYXQgaXMgYW55dGhpbmcgYnV0IDAgb3IgZmFsc2UuXG4gICAgcmV0dXJuIHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09ICcwJyAmJiB2YWx1ZS50b1VwcGVyQ2FzZSgpICE9PSAnRkFMU0UnO1xuICB9O1xuXG4gIC8vIElmIHdlIGZvcmNlIFRUWSwgd2UgYWx3YXlzIHJldHVybiB0cnVlLlxuICBjb25zdCBmb3JjZSA9IHByb2Nlc3MuZW52WydOR19GT1JDRV9UVFknXTtcbiAgaWYgKGZvcmNlICE9PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gaXNUcnV0aHkoZm9yY2UpO1xuICB9XG5cbiAgcmV0dXJuICEhcHJvY2Vzcy5zdGRvdXQuaXNUVFkgJiYgIWlzVHJ1dGh5KHByb2Nlc3MuZW52WydDSSddKTtcbn1cblxuaWYgKHJlcXVpcmUubWFpbiA9PT0gbW9kdWxlKSB7XG4gIGNvbnN0IGFyZ3MgPSBwcm9jZXNzLmFyZ3Yuc2xpY2UoMik7XG4gIG1haW4oeyBhcmdzIH0pXG4gICAgLnRoZW4oKGV4aXRDb2RlKSA9PiAocHJvY2Vzcy5leGl0Q29kZSA9IGV4aXRDb2RlKSlcbiAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgIHRocm93IGU7XG4gICAgfSk7XG59XG4iXX0=