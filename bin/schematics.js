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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2FuZ3VsYXJfZGV2a2l0L3NjaGVtYXRpY3NfY2xpL2Jpbi9zY2hlbWF0aWNzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0E7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILGdDQUFnQztBQUNoQyw2QkFBMkI7QUFDM0IsK0NBQTZEO0FBQzdELG9EQUErRTtBQUMvRSwyREFBMkU7QUFDM0UsNERBQWdFO0FBQ2hFLHdEQUEwQztBQUMxQyxtREFBcUM7QUFDckMsNkRBQWtFO0FBRWxFOzs7Ozs7Ozs7Ozs7O0dBYUc7QUFDSCxTQUFTLGtCQUFrQixDQUFDLEdBQWtCO0lBQzVDLElBQUksVUFBVSxHQUFHLGdDQUFnQyxDQUFDO0lBRWxELElBQUksU0FBUyxHQUFHLEdBQUcsQ0FBQztJQUNwQixJQUFJLFNBQVMsYUFBVCxTQUFTLHVCQUFULFNBQVMsQ0FBRSxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUU7UUFDNUIsTUFBTSxnQkFBZ0IsR0FBRyxTQUFTLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3BELENBQUMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxHQUFHO1lBQ3hCLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLGdCQUFnQixDQUFDO1lBQ3BDLFNBQVMsQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDO1NBQzFDLENBQUM7S0FDSDtJQUVELE9BQU8sRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFDbkMsQ0FBQztBQVFELFNBQVMsZUFBZSxDQUFDLFFBQXNCLEVBQUUsY0FBc0IsRUFBRSxNQUFzQjtJQUM3RixJQUFJO1FBQ0YsTUFBTSxVQUFVLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUNwRSxNQUFN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Y2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG4vKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuLy8gc3ltYm9sIHBvbHlmaWxsIG11c3QgZ28gZmlyc3RcbmltcG9ydCAnc3ltYm9sLW9ic2VydmFibGUnO1xuaW1wb3J0IHsgbG9nZ2luZywgc2NoZW1hLCB0YWdzIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgUHJvY2Vzc091dHB1dCwgY3JlYXRlQ29uc29sZUxvZ2dlciB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlL25vZGUnO1xuaW1wb3J0IHsgVW5zdWNjZXNzZnVsV29ya2Zsb3dFeGVjdXRpb24gfSBmcm9tICdAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcyc7XG5pbXBvcnQgeyBOb2RlV29ya2Zsb3cgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcy90b29scyc7XG5pbXBvcnQgKiBhcyBhbnNpQ29sb3JzIGZyb20gJ2Fuc2ktY29sb3JzJztcbmltcG9ydCAqIGFzIGlucXVpcmVyIGZyb20gJ2lucXVpcmVyJztcbmltcG9ydCB5YXJnc1BhcnNlciwgeyBjYW1lbENhc2UsIGRlY2FtZWxpemUgfSBmcm9tICd5YXJncy1wYXJzZXInO1xuXG4vKipcbiAqIFBhcnNlIHRoZSBuYW1lIG9mIHNjaGVtYXRpYyBwYXNzZWQgaW4gYXJndW1lbnQsIGFuZCByZXR1cm4gYSB7Y29sbGVjdGlvbiwgc2NoZW1hdGljfSBuYW1lZFxuICogdHVwbGUuIFRoZSB1c2VyIGNhbiBwYXNzIGluIGBjb2xsZWN0aW9uLW5hbWU6c2NoZW1hdGljLW5hbWVgLCBhbmQgdGhpcyBmdW5jdGlvbiB3aWxsIGVpdGhlclxuICogcmV0dXJuIGB7Y29sbGVjdGlvbjogJ2NvbGxlY3Rpb24tbmFtZScsIHNjaGVtYXRpYzogJ3NjaGVtYXRpYy1uYW1lJ31gLCBvciBpdCB3aWxsIGVycm9yIG91dFxuICogYW5kIHNob3cgdXNhZ2UuXG4gKlxuICogSW4gdGhlIGNhc2Ugd2hlcmUgYSBjb2xsZWN0aW9uIG5hbWUgaXNuJ3QgcGFydCBvZiB0aGUgYXJndW1lbnQsIHRoZSBkZWZhdWx0IGlzIHRvIHVzZSB0aGVcbiAqIHNjaGVtYXRpY3MgcGFja2FnZSAoQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MtY2xpKSBhcyB0aGUgY29sbGVjdGlvbi5cbiAqXG4gKiBUaGlzIGxvZ2ljIGlzIGVudGlyZWx5IHVwIHRvIHRoZSB0b29saW5nLlxuICpcbiAqIEBwYXJhbSBzdHIgVGhlIGFyZ3VtZW50IHRvIHBhcnNlLlxuICogQHJldHVybiB7e2NvbGxlY3Rpb246IHN0cmluZywgc2NoZW1hdGljOiAoc3RyaW5nKX19XG4gKi9cbmZ1bmN0aW9uIHBhcnNlU2NoZW1hdGljTmFtZShzdHI6IHN0cmluZyB8IG51bGwpOiB7IGNvbGxlY3Rpb246IHN0cmluZzsgc2NoZW1hdGljOiBzdHJpbmcgfCBudWxsIH0ge1xuICBsZXQgY29sbGVjdGlvbiA9ICdAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcy1jbGknO1xuXG4gIGxldCBzY2hlbWF0aWMgPSBzdHI7XG4gIGlmIChzY2hlbWF0aWM/LmluY2x1ZGVzKCc6JykpIHtcbiAgICBjb25zdCBsYXN0SW5kZXhPZkNvbG9uID0gc2NoZW1hdGljLmxhc3RJbmRleE9mKCc6Jyk7XG4gICAgW2NvbGxlY3Rpb24sIHNjaGVtYXRpY10gPSBbXG4gICAgICBzY2hlbWF0aWMuc2xpY2UoMCwgbGFzdEluZGV4T2ZDb2xvbiksXG4gICAgICBzY2hlbWF0aWMuc3Vic3RyaW5nKGxhc3RJbmRleE9mQ29sb24gKyAxKSxcbiAgICBdO1xuICB9XG5cbiAgcmV0dXJuIHsgY29sbGVjdGlvbiwgc2NoZW1hdGljIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWFpbk9wdGlvbnMge1xuICBhcmdzOiBzdHJpbmdbXTtcbiAgc3Rkb3V0PzogUHJvY2Vzc091dHB1dDtcbiAgc3RkZXJyPzogUHJvY2Vzc091dHB1dDtcbn1cblxuZnVuY3Rpb24gX2xpc3RTY2hlbWF0aWNzKHdvcmtmbG93OiBOb2RlV29ya2Zsb3csIGNvbGxlY3Rpb25OYW1lOiBzdHJpbmcsIGxvZ2dlcjogbG9nZ2luZy5Mb2dnZXIpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb2xsZWN0aW9uID0gd29ya2Zsb3cuZW5naW5lLmNyZWF0ZUNvbGxlY3Rpb24oY29sbGVjdGlvbk5hbWUpO1xuICAgIGxvZ2dlci5pbmZvKGNvbGxlY3Rpb24ubGlzdFNjaGVtYXRpY05hbWVzKCkuam9pbignXFxuJykpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5mYXRhbChlcnJvci5tZXNzYWdlKTtcblxuICAgIHJldHVybiAxO1xuICB9XG5cbiAgcmV0dXJuIDA7XG59XG5cbmZ1bmN0aW9uIF9jcmVhdGVQcm9tcHRQcm92aWRlcigpOiBzY2hlbWEuUHJvbXB0UHJvdmlkZXIge1xuICByZXR1cm4gKGRlZmluaXRpb25zKSA9PiB7XG4gICAgY29uc3QgcXVlc3Rpb25zOiBpbnF1aXJlci5RdWVzdGlvbkNvbGxlY3Rpb24gPSBkZWZpbml0aW9ucy5tYXAoKGRlZmluaXRpb24pID0+IHtcbiAgICAgIGNvbnN0IHF1ZXN0aW9uOiBpbnF1aXJlci5RdWVzdGlvbiA9IHtcbiAgICAgICAgbmFtZTogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgbWVzc2FnZTogZGVmaW5pdGlvbi5tZXNzYWdlLFxuICAgICAgICBkZWZhdWx0OiBkZWZpbml0aW9uLmRlZmF1bHQsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBkZWZpbml0aW9uLnZhbGlkYXRvcjtcbiAgICAgIGlmICh2YWxpZGF0b3IpIHtcbiAgICAgICAgcXVlc3Rpb24udmFsaWRhdGUgPSAoaW5wdXQpID0+IHZhbGlkYXRvcihpbnB1dCk7XG4gICAgICB9XG5cbiAgICAgIHN3aXRjaCAoZGVmaW5pdGlvbi50eXBlKSB7XG4gICAgICAgIGNhc2UgJ2NvbmZpcm1hdGlvbic6XG4gICAgICAgICAgcmV0dXJuIHsgLi4ucXVlc3Rpb24sIHR5cGU6ICdjb25maXJtJyB9O1xuICAgICAgICBjYXNlICdsaXN0JzpcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4ucXVlc3Rpb24sXG4gICAgICAgICAgICB0eXBlOiBkZWZpbml0aW9uLm11bHRpc2VsZWN0ID8gJ2NoZWNrYm94JyA6ICdsaXN0JyxcbiAgICAgICAgICAgIGNob2ljZXM6XG4gICAgICAgICAgICAgIGRlZmluaXRpb24uaXRlbXMgJiZcbiAgICAgICAgICAgICAgZGVmaW5pdGlvbi5pdGVtcy5tYXAoKGl0ZW0pID0+IHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGl0ZW0gPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBpdGVtO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBpdGVtLmxhYmVsLFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZTogaXRlbS52YWx1ZSxcbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICB9O1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHJldHVybiB7IC4uLnF1ZXN0aW9uLCB0eXBlOiBkZWZpbml0aW9uLnR5cGUgfTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBpbnF1aXJlci5wcm9tcHQocXVlc3Rpb25zKTtcbiAgfTtcbn1cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG1heC1saW5lcy1wZXItZnVuY3Rpb25cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYWluKHtcbiAgYXJncyxcbiAgc3Rkb3V0ID0gcHJvY2Vzcy5zdGRvdXQsXG4gIHN0ZGVyciA9IHByb2Nlc3Muc3RkZXJyLFxufTogTWFpbk9wdGlvbnMpOiBQcm9taXNlPDAgfCAxPiB7XG4gIGNvbnN0IHsgY2xpT3B0aW9ucywgc2NoZW1hdGljT3B0aW9ucywgXyB9ID0gcGFyc2VBcmdzKGFyZ3MpO1xuXG4gIC8vIENyZWF0ZSBhIHNlcGFyYXRlIGluc3RhbmNlIHRvIHByZXZlbnQgdW5pbnRlbmRlZCBnbG9iYWwgY2hhbmdlcyB0byB0aGUgY29sb3IgY29uZmlndXJhdGlvblxuICAvLyBDcmVhdGUgZnVuY3Rpb24gaXMgbm90IGRlZmluZWQgaW4gdGhlIHR5cGluZ3MuIFNlZTogaHR0cHM6Ly9naXRodWIuY29tL2Rvb3diL2Fuc2ktY29sb3JzL3B1bGwvNDRcbiAgY29uc3QgY29sb3JzID0gKGFuc2lDb2xvcnMgYXMgdHlwZW9mIGFuc2lDb2xvcnMgJiB7IGNyZWF0ZTogKCkgPT4gdHlwZW9mIGFuc2lDb2xvcnMgfSkuY3JlYXRlKCk7XG5cbiAgLyoqIENyZWF0ZSB0aGUgRGV2S2l0IExvZ2dlciB1c2VkIHRocm91Z2ggdGhlIENMSS4gKi9cbiAgY29uc3QgbG9nZ2VyID0gY3JlYXRlQ29uc29sZUxvZ2dlcighIWNsaU9wdGlvbnMudmVyYm9zZSwgc3Rkb3V0LCBzdGRlcnIsIHtcbiAgICBpbmZvOiAocykgPT4gcyxcbiAgICBkZWJ1ZzogKHMpID0+IHMsXG4gICAgd2FybjogKHMpID0+IGNvbG9ycy5ib2xkLnllbGxvdyhzKSxcbiAgICBlcnJvcjogKHMpID0+IGNvbG9ycy5ib2xkLnJlZChzKSxcbiAgICBmYXRhbDogKHMpID0+IGNvbG9ycy5ib2xkLnJlZChzKSxcbiAgfSk7XG5cbiAgaWYgKGNsaU9wdGlvbnMuaGVscCkge1xuICAgIGxvZ2dlci5pbmZvKGdldFVzYWdlKCkpO1xuXG4gICAgcmV0dXJuIDA7XG4gIH1cblxuICAvKiogR2V0IHRoZSBjb2xsZWN0aW9uIGFuIHNjaGVtYXRpYyBuYW1lIGZyb20gdGhlIGZpcnN0IGFyZ3VtZW50LiAqL1xuICBjb25zdCB7IGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLCBzY2hlbWF0aWM6IHNjaGVtYXRpY05hbWUgfSA9IHBhcnNlU2NoZW1hdGljTmFtZShcbiAgICBfLnNoaWZ0KCkgfHwgbnVsbCxcbiAgKTtcblxuICBjb25zdCBpc0xvY2FsQ29sbGVjdGlvbiA9IGNvbGxlY3Rpb25OYW1lLnN0YXJ0c1dpdGgoJy4nKSB8fCBjb2xsZWN0aW9uTmFtZS5zdGFydHNXaXRoKCcvJyk7XG5cbiAgLyoqIEdhdGhlciB0aGUgYXJndW1lbnRzIGZvciBsYXRlciB1c2UuICovXG4gIGNvbnN0IGRlYnVnUHJlc2VudCA9IGNsaU9wdGlvbnMuZGVidWcgIT09IG51bGw7XG4gIGNvbnN0IGRlYnVnID0gZGVidWdQcmVzZW50ID8gISFjbGlPcHRpb25zLmRlYnVnIDogaXNMb2NhbENvbGxlY3Rpb247XG4gIGNvbnN0IGRyeVJ1blByZXNlbnQgPSBjbGlPcHRpb25zWydkcnktcnVuJ10gIT09IG51bGw7XG4gIGNvbnN0IGRyeVJ1biA9IGRyeVJ1blByZXNlbnQgPyAhIWNsaU9wdGlvbnNbJ2RyeS1ydW4nXSA6IGRlYnVnO1xuICBjb25zdCBmb3JjZSA9ICEhY2xpT3B0aW9ucy5mb3JjZTtcbiAgY29uc3QgYWxsb3dQcml2YXRlID0gISFjbGlPcHRpb25zWydhbGxvdy1wcml2YXRlJ107XG5cbiAgLyoqIENyZWF0ZSB0aGUgd29ya2Zsb3cgc2NvcGVkIHRvIHRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGF0IHdpbGwgYmUgZXhlY3V0ZWQgd2l0aCB0aGlzIHJ1bi4gKi9cbiAgY29uc3Qgd29ya2Zsb3cgPSBuZXcgTm9kZVdvcmtmbG93KHByb2Nlc3MuY3dkKCksIHtcbiAgICBmb3JjZSxcbiAgICBkcnlSdW4sXG4gICAgcmVzb2x2ZVBhdGhzOiBbcHJvY2Vzcy5jd2QoKSwgX19kaXJuYW1lXSxcbiAgICBzY2hlbWFWYWxpZGF0aW9uOiB0cnVlLFxuICB9KTtcblxuICAvKiogSWYgdGhlIHVzZXIgd2FudHMgdG8gbGlzdCBzY2hlbWF0aWNzLCB3ZSBzaW1wbHkgc2hvdyBhbGwgdGhlIHNjaGVtYXRpYyBuYW1lcy4gKi9cbiAgaWYgKGNsaU9wdGlvbnNbJ2xpc3Qtc2NoZW1hdGljcyddKSB7XG4gICAgcmV0dXJuIF9saXN0U2NoZW1hdGljcyh3b3JrZmxvdywgY29sbGVjdGlvbk5hbWUsIGxvZ2dlcik7XG4gIH1cblxuICBpZiAoIXNjaGVtYXRpY05hbWUpIHtcbiAgICBsb2dnZXIuaW5mbyhnZXRVc2FnZSgpKTtcblxuICAgIHJldHVybiAxO1xuICB9XG5cbiAgaWYgKGRlYnVnKSB7XG4gICAgbG9nZ2VyLmluZm8oXG4gICAgICBgRGVidWcgbW9kZSBlbmFibGVkJHtpc0xvY2FsQ29sbGVjdGlvbiA/ICcgYnkgZGVmYXVsdCBmb3IgbG9jYWwgY29sbGVjdGlvbnMnIDogJyd9LmAsXG4gICAgKTtcbiAgfVxuXG4gIC8vIEluZGljYXRlIHRvIHRoZSB1c2VyIHdoZW4gbm90aGluZyBoYXMgYmVlbiBkb25lLiBUaGlzIGlzIGF1dG9tYXRpY2FsbHkgc2V0IHRvIG9mZiB3aGVuIHRoZXJlJ3NcbiAgLy8gYSBuZXcgRHJ5UnVuRXZlbnQuXG4gIGxldCBub3RoaW5nRG9uZSA9IHRydWU7XG5cbiAgLy8gTG9nZ2luZyBxdWV1ZSB0aGF0IHJlY2VpdmVzIGFsbCB0aGUgbWVzc2FnZXMgdG8gc2hvdyB0aGUgdXNlcnMuIFRoaXMgb25seSBnZXQgc2hvd24gd2hlbiBub1xuICAvLyBlcnJvcnMgaGFwcGVuZWQuXG4gIGxldCBsb2dnaW5nUXVldWU6IHN0cmluZ1tdID0gW107XG4gIGxldCBlcnJvciA9IGZhbHNlO1xuXG4gIC8qKlxuICAgKiBMb2dzIG91dCBkcnkgcnVuIGV2ZW50cy5cbiAgICpcbiAgICogQWxsIGV2ZW50cyB3aWxsIGFsd2F5cyBiZSBleGVjdXRlZCBoZXJlLCBpbiBvcmRlciBvZiBkaXNjb3ZlcnkuIFRoYXQgbWVhbnMgdGhhdCBhbiBlcnJvciB3b3VsZFxuICAgKiBiZSBzaG93biBhbG9uZyBvdGhlciBldmVudHMgd2hlbiBpdCBoYXBwZW5zLiBTaW5jZSBlcnJvcnMgaW4gd29ya2Zsb3dzIHdpbGwgc3RvcCB0aGUgT2JzZXJ2YWJsZVxuICAgKiBmcm9tIGNvbXBsZXRpbmcgc3VjY2Vzc2Z1bGx5LCB3ZSByZWNvcmQgYW55IGV2ZW50cyBvdGhlciB0aGFuIGVycm9ycywgdGhlbiBvbiBjb21wbGV0aW9uIHdlXG4gICAqIHNob3cgdGhlbS5cbiAgICpcbiAgICogVGhpcyBpcyBhIHNpbXBsZSB3YXkgdG8gb25seSBzaG93IGVycm9ycyB3aGVuIGFuIGVycm9yIG9jY3VyLlxuICAgKi9cbiAgd29ya2Zsb3cucmVwb3J0ZXIuc3Vic2NyaWJlKChldmVudCkgPT4ge1xuICAgIG5vdGhpbmdEb25lID0gZmFsc2U7XG4gICAgLy8gU3RyaXAgbGVhZGluZyBzbGFzaCB0byBwcmV2ZW50IGNvbmZ1c2lvbi5cbiAgICBjb25zdCBldmVudFBhdGggPSBldmVudC5wYXRoLnN0YXJ0c1dpdGgoJy8nKSA/IGV2ZW50LnBhdGguc3Vic3RyKDEpIDogZXZlbnQucGF0aDtcblxuICAgIHN3aXRjaCAoZXZlbnQua2luZCkge1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgICBlcnJvciA9IHRydWU7XG5cbiAgICAgICAgY29uc3QgZGVzYyA9IGV2ZW50LmRlc2NyaXB0aW9uID09ICdhbHJlYWR5RXhpc3QnID8gJ2FscmVhZHkgZXhpc3RzJyA6ICdkb2VzIG5vdCBleGlzdCc7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRVJST1IhICR7ZXZlbnRQYXRofSAke2Rlc2N9LmApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke2NvbG9ycy5jeWFuKCdVUERBVEUnKX0gJHtldmVudFBhdGh9ICgke2V2ZW50LmNvbnRlbnQubGVuZ3RofSBieXRlcylgKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdjcmVhdGUnOlxuICAgICAgICBsb2dnaW5nUXVldWUucHVzaChgJHtjb2xvcnMuZ3JlZW4oJ0NSRUFURScpfSAke2V2ZW50UGF0aH0gKCR7ZXZlbnQuY29udGVudC5sZW5ndGh9IGJ5dGVzKWApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2RlbGV0ZSc6XG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke2NvbG9ycy55ZWxsb3coJ0RFTEVURScpfSAke2V2ZW50UGF0aH1gKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdyZW5hbWUnOlxuICAgICAgICBjb25zdCBldmVudFRvUGF0aCA9IGV2ZW50LnRvLnN0YXJ0c1dpdGgoJy8nKSA/IGV2ZW50LnRvLnN1YnN0cigxKSA6IGV2ZW50LnRvO1xuICAgICAgICBsb2dnaW5nUXVldWUucHVzaChgJHtjb2xvcnMuYmx1ZSgnUkVOQU1FJyl9ICR7ZXZlbnRQYXRofSA9PiAke2V2ZW50VG9QYXRofWApO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH0pO1xuXG4gIC8qKlxuICAgKiBMaXN0ZW4gdG8gbGlmZWN5Y2xlIGV2ZW50cyBvZiB0aGUgd29ya2Zsb3cgdG8gZmx1c2ggdGhlIGxvZ3MgYmV0d2VlbiBlYWNoIHBoYXNlcy5cbiAgICovXG4gIHdvcmtmbG93LmxpZmVDeWNsZS5zdWJzY3JpYmUoKGV2ZW50KSA9PiB7XG4gICAgaWYgKGV2ZW50LmtpbmQgPT0gJ3dvcmtmbG93LWVuZCcgfHwgZXZlbnQua2luZCA9PSAncG9zdC10YXNrcy1zdGFydCcpIHtcbiAgICAgIGlmICghZXJyb3IpIHtcbiAgICAgICAgLy8gRmx1c2ggdGhlIGxvZyBxdWV1ZSBhbmQgY2xlYW4gdGhlIGVycm9yIHN0YXRlLlxuICAgICAgICBsb2dnaW5nUXVldWUuZm9yRWFjaCgobG9nKSA9PiBsb2dnZXIuaW5mbyhsb2cpKTtcbiAgICAgIH1cblxuICAgICAgbG9nZ2luZ1F1ZXVlID0gW107XG4gICAgICBlcnJvciA9IGZhbHNlO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gU2hvdyB1c2FnZSBvZiBkZXByZWNhdGVkIG9wdGlvbnNcbiAgd29ya2Zsb3cucmVnaXN0cnkudXNlWERlcHJlY2F0ZWRQcm92aWRlcigobXNnKSA9PiBsb2dnZXIud2Fybihtc2cpKTtcblxuICAvLyBQYXNzIHRoZSByZXN0IG9mIHRoZSBhcmd1bWVudHMgYXMgdGhlIHNtYXJ0IGRlZmF1bHQgXCJhcmd2XCIuIFRoZW4gZGVsZXRlIGl0LlxuICB3b3JrZmxvdy5yZWdpc3RyeS5hZGRTbWFydERlZmF1bHRQcm92aWRlcignYXJndicsIChzY2hlbWEpID0+XG4gICAgJ2luZGV4JyBpbiBzY2hlbWEgPyBfW051bWJlcihzY2hlbWFbJ2luZGV4J10pXSA6IF8sXG4gICk7XG5cbiAgLy8gQWRkIHByb21wdHMuXG4gIGlmIChjbGlPcHRpb25zLmludGVyYWN0aXZlICYmIGlzVFRZKCkpIHtcbiAgICB3b3JrZmxvdy5yZWdpc3RyeS51c2VQcm9tcHRQcm92aWRlcihfY3JlYXRlUHJvbXB0UHJvdmlkZXIoKSk7XG4gIH1cblxuICAvKipcbiAgICogIEV4ZWN1dGUgdGhlIHdvcmtmbG93LCB3aGljaCB3aWxsIHJlcG9ydCB0aGUgZHJ5IHJ1biBldmVudHMsIHJ1biB0aGUgdGFza3MsIGFuZCBjb21wbGV0ZVxuICAgKiAgYWZ0ZXIgYWxsIGlzIGRvbmUuXG4gICAqXG4gICAqICBUaGUgT2JzZXJ2YWJsZSByZXR1cm5lZCB3aWxsIHByb3Blcmx5IGNhbmNlbCB0aGUgd29ya2Zsb3cgaWYgdW5zdWJzY3JpYmVkLCBlcnJvciBvdXQgaWYgQU5ZXG4gICAqICBzdGVwIG9mIHRoZSB3b3JrZmxvdyBmYWlsZWQgKHNpbmsgb3IgdGFzayksIHdpdGggZGV0YWlscyBpbmNsdWRlZCwgYW5kIHdpbGwgb25seSBjb21wbGV0ZVxuICAgKiAgd2hlbiBldmVyeXRoaW5nIGlzIGRvbmUuXG4gICAqL1xuICB0cnkge1xuICAgIGF3YWl0IHdvcmtmbG93XG4gICAgICAuZXhlY3V0ZSh7XG4gICAgICAgIGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLFxuICAgICAgICBzY2hlbWF0aWM6IHNjaGVtYXRpY05hbWUsXG4gICAgICAgIG9wdGlvbnM6IHNjaGVtYXRpY09wdGlvbnMsXG4gICAgICAgIGFsbG93UHJpdmF0ZTogYWxsb3dQcml2YXRlLFxuICAgICAgICBkZWJ1ZzogZGVidWcsXG4gICAgICAgIGxvZ2dlcjogbG9nZ2VyLFxuICAgICAgfSlcbiAgICAgIC50b1Byb21pc2UoKTtcblxuICAgIGlmIChub3RoaW5nRG9uZSkge1xuICAgICAgbG9nZ2VyLmluZm8oJ05vdGhpbmcgdG8gYmUgZG9uZS4nKTtcbiAgICB9IGVsc2UgaWYgKGRyeVJ1bikge1xuICAgICAgbG9nZ2VyLmluZm8oXG4gICAgICAgIGBEcnkgcnVuIGVuYWJsZWQke1xuICAgICAgICAgIGRyeVJ1blByZXNlbnQgPyAnJyA6ICcgYnkgZGVmYXVsdCBpbiBkZWJ1ZyBtb2RlJ1xuICAgICAgICB9LiBObyBmaWxlcyB3cml0dGVuIHRvIGRpc2suYCxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIDA7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBVbnN1Y2Nlc3NmdWxXb3JrZmxvd0V4ZWN1dGlvbikge1xuICAgICAgLy8gXCJTZWUgYWJvdmVcIiBiZWNhdXNlIHdlIGFscmVhZHkgcHJpbnRlZCB0aGUgZXJyb3IuXG4gICAgICBsb2dnZXIuZmF0YWwoJ1RoZSBTY2hlbWF0aWMgd29ya2Zsb3cgZmFpbGVkLiBTZWUgYWJvdmUuJyk7XG4gICAgfSBlbHNlIGlmIChkZWJ1Zykge1xuICAgICAgbG9nZ2VyLmZhdGFsKGBBbiBlcnJvciBvY2N1cmVkOlxcbiR7ZXJyLnN0YWNrfWApO1xuICAgIH0gZWxzZSB7XG4gICAgICBsb2dnZXIuZmF0YWwoYEVycm9yOiAke2Vyci5tZXNzYWdlfWApO1xuICAgIH1cblxuICAgIHJldHVybiAxO1xuICB9XG59XG5cbi8qKlxuICogR2V0IHVzYWdlIG9mIHRoZSBDTEkgdG9vbC5cbiAqL1xuZnVuY3Rpb24gZ2V0VXNhZ2UoKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRhZ3Muc3RyaXBJbmRlbnRgXG4gIHNjaGVtYXRpY3MgW2NvbGxlY3Rpb24tbmFtZTpdc2NoZW1hdGljLW5hbWUgW29wdGlvbnMsIC4uLl1cblxuICBCeSBkZWZhdWx0LCBpZiB0aGUgY29sbGVjdGlvbiBuYW1lIGlzIG5vdCBzcGVjaWZpZWQsIHVzZSB0aGUgaW50ZXJuYWwgY29sbGVjdGlvbiBwcm92aWRlZFxuICBieSB0aGUgU2NoZW1hdGljcyBDTEkuXG5cbiAgT3B0aW9uczpcbiAgICAgIC0tZGVidWcgICAgICAgICAgICAgRGVidWcgbW9kZS4gVGhpcyBpcyB0cnVlIGJ5IGRlZmF1bHQgaWYgdGhlIGNvbGxlY3Rpb24gaXMgYSByZWxhdGl2ZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoIChpbiB0aGF0IGNhc2UsIHR1cm4gb2ZmIHdpdGggLS1kZWJ1Zz1mYWxzZSkuXG5cbiAgICAgIC0tYWxsb3ctcHJpdmF0ZSAgICAgQWxsb3cgcHJpdmF0ZSBzY2hlbWF0aWNzIHRvIGJlIHJ1biBmcm9tIHRoZSBjb21tYW5kIGxpbmUuIERlZmF1bHQgdG9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgZmFsc2UuXG5cbiAgICAgIC0tZHJ5LXJ1biAgICAgICAgICAgRG8gbm90IG91dHB1dCBhbnl0aGluZywgYnV0IGluc3RlYWQganVzdCBzaG93IHdoYXQgYWN0aW9ucyB3b3VsZCBiZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJmb3JtZWQuIERlZmF1bHQgdG8gdHJ1ZSBpZiBkZWJ1ZyBpcyBhbHNvIHRydWUuXG5cbiAgICAgIC0tZm9yY2UgICAgICAgICAgICAgRm9yY2Ugb3ZlcndyaXRpbmcgZmlsZXMgdGhhdCB3b3VsZCBvdGhlcndpc2UgYmUgYW4gZXJyb3IuXG5cbiAgICAgIC0tbGlzdC1zY2hlbWF0aWNzICAgTGlzdCBhbGwgc2NoZW1hdGljcyBmcm9tIHRoZSBjb2xsZWN0aW9uLCBieSBuYW1lLiBBIGNvbGxlY3Rpb24gbmFtZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBzaG91bGQgYmUgc3VmZml4ZWQgYnkgYSBjb2xvbi4gRXhhbXBsZTogJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzLWNsaTonLlxuXG4gICAgICAtLW5vLWludGVyYWN0aXZlICAgIERpc2FibGVzIGludGVyYWN0aXZlIGlucHV0IHByb21wdHMuXG5cbiAgICAgIC0tdmVyYm9zZSAgICAgICAgICAgU2hvdyBtb3JlIGluZm9ybWF0aW9uLlxuXG4gICAgICAtLWhlbHAgICAgICAgICAgICAgIFNob3cgdGhpcyBtZXNzYWdlLlxuXG4gIEFueSBhZGRpdGlvbmFsIG9wdGlvbiBpcyBwYXNzZWQgdG8gdGhlIFNjaGVtYXRpY3MgZGVwZW5kaW5nIG9uIGl0cyBzY2hlbWEuXG4gIGA7XG59XG5cbi8qKiBQYXJzZSB0aGUgY29tbWFuZCBsaW5lLiAqL1xuY29uc3QgYm9vbGVhbkFyZ3MgPSBbXG4gICdhbGxvdy1wcml2YXRlJyxcbiAgJ2RlYnVnJyxcbiAgJ2RyeS1ydW4nLFxuICAnZm9yY2UnLFxuICAnaGVscCcsXG4gICdsaXN0LXNjaGVtYXRpY3MnLFxuICAndmVyYm9zZScsXG4gICdpbnRlcmFjdGl2ZScsXG5dIGFzIGNvbnN0O1xuXG50eXBlIEVsZW1lbnRUeXBlPFQgZXh0ZW5kcyBSZWFkb25seUFycmF5PHVua25vd24+PiA9IFQgZXh0ZW5kcyBSZWFkb25seUFycmF5PGluZmVyIEVsZW1lbnRUeXBlPlxuICA/IEVsZW1lbnRUeXBlXG4gIDogbmV2ZXI7XG5cbmludGVyZmFjZSBPcHRpb25zIHtcbiAgXzogc3RyaW5nW107XG4gIHNjaGVtYXRpY09wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBjbGlPcHRpb25zOiBQYXJ0aWFsPFJlY29yZDxFbGVtZW50VHlwZTx0eXBlb2YgYm9vbGVhbkFyZ3M+LCBib29sZWFuIHwgbnVsbD4+O1xufVxuXG4vKiogUGFyc2UgdGhlIGNvbW1hbmQgbGluZS4gKi9cbmZ1bmN0aW9uIHBhcnNlQXJncyhhcmdzOiBzdHJpbmdbXSk6IE9wdGlvbnMge1xuICBjb25zdCB7IF8sIC4uLm9wdGlvbnMgfSA9IHlhcmdzUGFyc2VyKGFyZ3MsIHtcbiAgICBib29sZWFuOiBib29sZWFuQXJncyBhcyB1bmtub3duIGFzIHN0cmluZ1tdLFxuICAgIGRlZmF1bHQ6IHtcbiAgICAgICdpbnRlcmFjdGl2ZSc6IHRydWUsXG4gICAgICAnZGVidWcnOiBudWxsLFxuICAgICAgJ2RyeS1ydW4nOiBudWxsLFxuICAgIH0sXG4gICAgY29uZmlndXJhdGlvbjoge1xuICAgICAgJ2RvdC1ub3RhdGlvbic6IGZhbHNlLFxuICAgICAgJ2Jvb2xlYW4tbmVnYXRpb24nOiB0cnVlLFxuICAgICAgJ3N0cmlwLWFsaWFzZWQnOiB0cnVlLFxuICAgICAgJ2NhbWVsLWNhc2UtZXhwYW5zaW9uJzogZmFsc2UsXG4gICAgfSxcbiAgfSk7XG5cbiAgLy8gQ2FtZWxpemUgb3B0aW9ucyBhcyB5YXJncyB3aWxsIHJldHVybiB0aGUgb2JqZWN0IGluIGtlYmFiLWNhc2Ugd2hlbiBjYW1lbCBjYXNpbmcgaXMgZGlzYWJsZWQuXG4gIGNvbnN0IHNjaGVtYXRpY09wdGlvbnM6IE9wdGlvbnNbJ3NjaGVtYXRpY09wdGlvbnMnXSA9IHt9O1xuICBjb25zdCBjbGlPcHRpb25zOiBPcHRpb25zWydjbGlPcHRpb25zJ10gPSB7fTtcblxuICBjb25zdCBpc0NsaU9wdGlvbnMgPSAoXG4gICAga2V5OiBFbGVtZW50VHlwZTx0eXBlb2YgYm9vbGVhbkFyZ3M+IHwgc3RyaW5nLFxuICApOiBrZXkgaXMgRWxlbWVudFR5cGU8dHlwZW9mIGJvb2xlYW5BcmdzPiA9PlxuICAgIGJvb2xlYW5BcmdzLmluY2x1ZGVzKGtleSBhcyBFbGVtZW50VHlwZTx0eXBlb2YgYm9vbGVhbkFyZ3M+KTtcblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhvcHRpb25zKSkge1xuICAgIGlmICgvW0EtWl0vLnRlc3Qoa2V5KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGFyZ3VtZW50ICR7a2V5fS4gRGlkIHlvdSBtZWFuICR7ZGVjYW1lbGl6ZShrZXkpfT9gKTtcbiAgICB9XG5cbiAgICBpZiAoaXNDbGlPcHRpb25zKGtleSkpIHtcbiAgICAgIGNsaU9wdGlvbnNba2V5XSA9IHZhbHVlO1xuICAgIH0gZWxzZSB7XG4gICAgICBzY2hlbWF0aWNPcHRpb25zW2NhbWVsQ2FzZShrZXkpXSA9IHZhbHVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgXzogXy5tYXAoKHYpID0+IHYudG9TdHJpbmcoKSksXG4gICAgc2NoZW1hdGljT3B0aW9ucyxcbiAgICBjbGlPcHRpb25zLFxuICB9O1xufVxuXG5mdW5jdGlvbiBpc1RUWSgpOiBib29sZWFuIHtcbiAgY29uc3QgaXNUcnV0aHkgPSAodmFsdWU6IHVuZGVmaW5lZCB8IHN0cmluZykgPT4ge1xuICAgIC8vIFJldHVybnMgdHJ1ZSBpZiB2YWx1ZSBpcyBhIHN0cmluZyB0aGF0IGlzIGFueXRoaW5nIGJ1dCAwIG9yIGZhbHNlLlxuICAgIHJldHVybiB2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSAnMCcgJiYgdmFsdWUudG9VcHBlckNhc2UoKSAhPT0gJ0ZBTFNFJztcbiAgfTtcblxuICAvLyBJZiB3ZSBmb3JjZSBUVFksIHdlIGFsd2F5cyByZXR1cm4gdHJ1ZS5cbiAgY29uc3QgZm9yY2UgPSBwcm9jZXNzLmVudlsnTkdfRk9SQ0VfVFRZJ107XG4gIGlmIChmb3JjZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGlzVHJ1dGh5KGZvcmNlKTtcbiAgfVxuXG4gIHJldHVybiAhIXByb2Nlc3Muc3Rkb3V0LmlzVFRZICYmICFpc1RydXRoeShwcm9jZXNzLmVudlsnQ0knXSk7XG59XG5cbmlmIChyZXF1aXJlLm1haW4gPT09IG1vZHVsZSkge1xuICBjb25zdCBhcmdzID0gcHJvY2Vzcy5hcmd2LnNsaWNlKDIpO1xuICBtYWluKHsgYXJncyB9KVxuICAgIC50aGVuKChleGl0Q29kZSkgPT4gKHByb2Nlc3MuZXhpdENvZGUgPSBleGl0Q29kZSkpXG4gICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICB0aHJvdyBlO1xuICAgIH0pO1xufVxuIl19