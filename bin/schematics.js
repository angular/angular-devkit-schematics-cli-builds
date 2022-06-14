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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2FuZ3VsYXJfZGV2a2l0L3NjaGVtYXRpY3NfY2xpL2Jpbi9zY2hlbWF0aWNzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0E7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILGdDQUFnQztBQUNoQyw2QkFBMkI7QUFDM0IsK0NBQTZEO0FBQzdELG9EQUErRTtBQUMvRSwyREFBMkU7QUFDM0UsNERBQWdFO0FBQ2hFLHdEQUEwQztBQUMxQyxtREFBcUM7QUFDckMsNkRBQWtFO0FBRWxFOzs7Ozs7Ozs7Ozs7O0dBYUc7QUFDSCxTQUFTLGtCQUFrQixDQUFDLEdBQWtCO0lBQzVDLElBQUksVUFBVSxHQUFHLGdDQUFnQyxDQUFDO0lBRWxELElBQUksU0FBUyxHQUFHLEdBQUcsQ0FBQztJQUNwQixJQUFJLFNBQVMsYUFBVCxTQUFTLHVCQUFULFNBQVMsQ0FBRSxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUU7UUFDNUIsTUFBTSxnQkFBZ0IsR0FBRyxTQUFTLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3BELENBQUMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxHQUFHO1lBQ3hCLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLGdCQUFnQixDQUFDO1lBQ3BDLFNBQVMsQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDO1NBQzFDLENBQUM7S0FDSDtJQUVELE9BQU8sRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFDbkMsQ0FBQztBQVFELFNBQVMsZUFBZSxDQUFDLFFBQXNCLEVBQUUsY0FBc0IsRUFBRSxNQUFzQjtJQUM3RixJQUFJO1FBQ0YsTUFBTSxVQUFVLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUNwRSxNQUFN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QUMsQ0FBQyxPQUFPLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQyxDQUFDO1NBQ2pELEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFO1FBQ1gsTUFBTSxDQUFDLENBQUM7SUFDVixDQUFDLENBQUMsQ0FBQztDQUNOIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbi8vIHN5bWJvbCBwb2x5ZmlsbCBtdXN0IGdvIGZpcnN0XG5pbXBvcnQgJ3N5bWJvbC1vYnNlcnZhYmxlJztcbmltcG9ydCB7IGxvZ2dpbmcsIHNjaGVtYSwgdGFncyB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlJztcbmltcG9ydCB7IFByb2Nlc3NPdXRwdXQsIGNyZWF0ZUNvbnNvbGVMb2dnZXIgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZS9ub2RlJztcbmltcG9ydCB7IFVuc3VjY2Vzc2Z1bFdvcmtmbG93RXhlY3V0aW9uIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MnO1xuaW1wb3J0IHsgTm9kZVdvcmtmbG93IH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MvdG9vbHMnO1xuaW1wb3J0ICogYXMgYW5zaUNvbG9ycyBmcm9tICdhbnNpLWNvbG9ycyc7XG5pbXBvcnQgKiBhcyBpbnF1aXJlciBmcm9tICdpbnF1aXJlcic7XG5pbXBvcnQgeWFyZ3NQYXJzZXIsIHsgY2FtZWxDYXNlLCBkZWNhbWVsaXplIH0gZnJvbSAneWFyZ3MtcGFyc2VyJztcblxuLyoqXG4gKiBQYXJzZSB0aGUgbmFtZSBvZiBzY2hlbWF0aWMgcGFzc2VkIGluIGFyZ3VtZW50LCBhbmQgcmV0dXJuIGEge2NvbGxlY3Rpb24sIHNjaGVtYXRpY30gbmFtZWRcbiAqIHR1cGxlLiBUaGUgdXNlciBjYW4gcGFzcyBpbiBgY29sbGVjdGlvbi1uYW1lOnNjaGVtYXRpYy1uYW1lYCwgYW5kIHRoaXMgZnVuY3Rpb24gd2lsbCBlaXRoZXJcbiAqIHJldHVybiBge2NvbGxlY3Rpb246ICdjb2xsZWN0aW9uLW5hbWUnLCBzY2hlbWF0aWM6ICdzY2hlbWF0aWMtbmFtZSd9YCwgb3IgaXQgd2lsbCBlcnJvciBvdXRcbiAqIGFuZCBzaG93IHVzYWdlLlxuICpcbiAqIEluIHRoZSBjYXNlIHdoZXJlIGEgY29sbGVjdGlvbiBuYW1lIGlzbid0IHBhcnQgb2YgdGhlIGFyZ3VtZW50LCB0aGUgZGVmYXVsdCBpcyB0byB1c2UgdGhlXG4gKiBzY2hlbWF0aWNzIHBhY2thZ2UgKEBhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzLWNsaSkgYXMgdGhlIGNvbGxlY3Rpb24uXG4gKlxuICogVGhpcyBsb2dpYyBpcyBlbnRpcmVseSB1cCB0byB0aGUgdG9vbGluZy5cbiAqXG4gKiBAcGFyYW0gc3RyIFRoZSBhcmd1bWVudCB0byBwYXJzZS5cbiAqIEByZXR1cm4ge3tjb2xsZWN0aW9uOiBzdHJpbmcsIHNjaGVtYXRpYzogKHN0cmluZyl9fVxuICovXG5mdW5jdGlvbiBwYXJzZVNjaGVtYXRpY05hbWUoc3RyOiBzdHJpbmcgfCBudWxsKTogeyBjb2xsZWN0aW9uOiBzdHJpbmc7IHNjaGVtYXRpYzogc3RyaW5nIHwgbnVsbCB9IHtcbiAgbGV0IGNvbGxlY3Rpb24gPSAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MtY2xpJztcblxuICBsZXQgc2NoZW1hdGljID0gc3RyO1xuICBpZiAoc2NoZW1hdGljPy5pbmNsdWRlcygnOicpKSB7XG4gICAgY29uc3QgbGFzdEluZGV4T2ZDb2xvbiA9IHNjaGVtYXRpYy5sYXN0SW5kZXhPZignOicpO1xuICAgIFtjb2xsZWN0aW9uLCBzY2hlbWF0aWNdID0gW1xuICAgICAgc2NoZW1hdGljLnNsaWNlKDAsIGxhc3RJbmRleE9mQ29sb24pLFxuICAgICAgc2NoZW1hdGljLnN1YnN0cmluZyhsYXN0SW5kZXhPZkNvbG9uICsgMSksXG4gICAgXTtcbiAgfVxuXG4gIHJldHVybiB7IGNvbGxlY3Rpb24sIHNjaGVtYXRpYyB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE1haW5PcHRpb25zIHtcbiAgYXJnczogc3RyaW5nW107XG4gIHN0ZG91dD86IFByb2Nlc3NPdXRwdXQ7XG4gIHN0ZGVycj86IFByb2Nlc3NPdXRwdXQ7XG59XG5cbmZ1bmN0aW9uIF9saXN0U2NoZW1hdGljcyh3b3JrZmxvdzogTm9kZVdvcmtmbG93LCBjb2xsZWN0aW9uTmFtZTogc3RyaW5nLCBsb2dnZXI6IGxvZ2dpbmcuTG9nZ2VyKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgY29sbGVjdGlvbiA9IHdvcmtmbG93LmVuZ2luZS5jcmVhdGVDb2xsZWN0aW9uKGNvbGxlY3Rpb25OYW1lKTtcbiAgICBsb2dnZXIuaW5mbyhjb2xsZWN0aW9uLmxpc3RTY2hlbWF0aWNOYW1lcygpLmpvaW4oJ1xcbicpKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBsb2dnZXIuZmF0YWwoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBgJHtlcnJvcn1gKTtcblxuICAgIHJldHVybiAxO1xuICB9XG5cbiAgcmV0dXJuIDA7XG59XG5cbmZ1bmN0aW9uIF9jcmVhdGVQcm9tcHRQcm92aWRlcigpOiBzY2hlbWEuUHJvbXB0UHJvdmlkZXIge1xuICByZXR1cm4gKGRlZmluaXRpb25zKSA9PiB7XG4gICAgY29uc3QgcXVlc3Rpb25zOiBpbnF1aXJlci5RdWVzdGlvbkNvbGxlY3Rpb24gPSBkZWZpbml0aW9ucy5tYXAoKGRlZmluaXRpb24pID0+IHtcbiAgICAgIGNvbnN0IHF1ZXN0aW9uOiBpbnF1aXJlci5RdWVzdGlvbiA9IHtcbiAgICAgICAgbmFtZTogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgbWVzc2FnZTogZGVmaW5pdGlvbi5tZXNzYWdlLFxuICAgICAgICBkZWZhdWx0OiBkZWZpbml0aW9uLmRlZmF1bHQsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBkZWZpbml0aW9uLnZhbGlkYXRvcjtcbiAgICAgIGlmICh2YWxpZGF0b3IpIHtcbiAgICAgICAgcXVlc3Rpb24udmFsaWRhdGUgPSAoaW5wdXQpID0+IHZhbGlkYXRvcihpbnB1dCk7XG4gICAgICB9XG5cbiAgICAgIHN3aXRjaCAoZGVmaW5pdGlvbi50eXBlKSB7XG4gICAgICAgIGNhc2UgJ2NvbmZpcm1hdGlvbic6XG4gICAgICAgICAgcmV0dXJuIHsgLi4ucXVlc3Rpb24sIHR5cGU6ICdjb25maXJtJyB9O1xuICAgICAgICBjYXNlICdsaXN0JzpcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4ucXVlc3Rpb24sXG4gICAgICAgICAgICB0eXBlOiBkZWZpbml0aW9uLm11bHRpc2VsZWN0ID8gJ2NoZWNrYm94JyA6ICdsaXN0JyxcbiAgICAgICAgICAgIGNob2ljZXM6XG4gICAgICAgICAgICAgIGRlZmluaXRpb24uaXRlbXMgJiZcbiAgICAgICAgICAgICAgZGVmaW5pdGlvbi5pdGVtcy5tYXAoKGl0ZW0pID0+IHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGl0ZW0gPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBpdGVtO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBpdGVtLmxhYmVsLFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZTogaXRlbS52YWx1ZSxcbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICB9O1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHJldHVybiB7IC4uLnF1ZXN0aW9uLCB0eXBlOiBkZWZpbml0aW9uLnR5cGUgfTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBpbnF1aXJlci5wcm9tcHQocXVlc3Rpb25zKTtcbiAgfTtcbn1cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG1heC1saW5lcy1wZXItZnVuY3Rpb25cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYWluKHtcbiAgYXJncyxcbiAgc3Rkb3V0ID0gcHJvY2Vzcy5zdGRvdXQsXG4gIHN0ZGVyciA9IHByb2Nlc3Muc3RkZXJyLFxufTogTWFpbk9wdGlvbnMpOiBQcm9taXNlPDAgfCAxPiB7XG4gIGNvbnN0IHsgY2xpT3B0aW9ucywgc2NoZW1hdGljT3B0aW9ucywgXyB9ID0gcGFyc2VBcmdzKGFyZ3MpO1xuXG4gIC8vIENyZWF0ZSBhIHNlcGFyYXRlIGluc3RhbmNlIHRvIHByZXZlbnQgdW5pbnRlbmRlZCBnbG9iYWwgY2hhbmdlcyB0byB0aGUgY29sb3IgY29uZmlndXJhdGlvblxuICAvLyBDcmVhdGUgZnVuY3Rpb24gaXMgbm90IGRlZmluZWQgaW4gdGhlIHR5cGluZ3MuIFNlZTogaHR0cHM6Ly9naXRodWIuY29tL2Rvb3diL2Fuc2ktY29sb3JzL3B1bGwvNDRcbiAgY29uc3QgY29sb3JzID0gKGFuc2lDb2xvcnMgYXMgdHlwZW9mIGFuc2lDb2xvcnMgJiB7IGNyZWF0ZTogKCkgPT4gdHlwZW9mIGFuc2lDb2xvcnMgfSkuY3JlYXRlKCk7XG5cbiAgLyoqIENyZWF0ZSB0aGUgRGV2S2l0IExvZ2dlciB1c2VkIHRocm91Z2ggdGhlIENMSS4gKi9cbiAgY29uc3QgbG9nZ2VyID0gY3JlYXRlQ29uc29sZUxvZ2dlcighIWNsaU9wdGlvbnMudmVyYm9zZSwgc3Rkb3V0LCBzdGRlcnIsIHtcbiAgICBpbmZvOiAocykgPT4gcyxcbiAgICBkZWJ1ZzogKHMpID0+IHMsXG4gICAgd2FybjogKHMpID0+IGNvbG9ycy5ib2xkLnllbGxvdyhzKSxcbiAgICBlcnJvcjogKHMpID0+IGNvbG9ycy5ib2xkLnJlZChzKSxcbiAgICBmYXRhbDogKHMpID0+IGNvbG9ycy5ib2xkLnJlZChzKSxcbiAgfSk7XG5cbiAgaWYgKGNsaU9wdGlvbnMuaGVscCkge1xuICAgIGxvZ2dlci5pbmZvKGdldFVzYWdlKCkpO1xuXG4gICAgcmV0dXJuIDA7XG4gIH1cblxuICAvKiogR2V0IHRoZSBjb2xsZWN0aW9uIGFuIHNjaGVtYXRpYyBuYW1lIGZyb20gdGhlIGZpcnN0IGFyZ3VtZW50LiAqL1xuICBjb25zdCB7IGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLCBzY2hlbWF0aWM6IHNjaGVtYXRpY05hbWUgfSA9IHBhcnNlU2NoZW1hdGljTmFtZShcbiAgICBfLnNoaWZ0KCkgfHwgbnVsbCxcbiAgKTtcblxuICBjb25zdCBpc0xvY2FsQ29sbGVjdGlvbiA9IGNvbGxlY3Rpb25OYW1lLnN0YXJ0c1dpdGgoJy4nKSB8fCBjb2xsZWN0aW9uTmFtZS5zdGFydHNXaXRoKCcvJyk7XG5cbiAgLyoqIEdhdGhlciB0aGUgYXJndW1lbnRzIGZvciBsYXRlciB1c2UuICovXG4gIGNvbnN0IGRlYnVnUHJlc2VudCA9IGNsaU9wdGlvbnMuZGVidWcgIT09IG51bGw7XG4gIGNvbnN0IGRlYnVnID0gZGVidWdQcmVzZW50ID8gISFjbGlPcHRpb25zLmRlYnVnIDogaXNMb2NhbENvbGxlY3Rpb247XG4gIGNvbnN0IGRyeVJ1blByZXNlbnQgPSBjbGlPcHRpb25zWydkcnktcnVuJ10gIT09IG51bGw7XG4gIGNvbnN0IGRyeVJ1biA9IGRyeVJ1blByZXNlbnQgPyAhIWNsaU9wdGlvbnNbJ2RyeS1ydW4nXSA6IGRlYnVnO1xuICBjb25zdCBmb3JjZSA9ICEhY2xpT3B0aW9ucy5mb3JjZTtcbiAgY29uc3QgYWxsb3dQcml2YXRlID0gISFjbGlPcHRpb25zWydhbGxvdy1wcml2YXRlJ107XG5cbiAgLyoqIENyZWF0ZSB0aGUgd29ya2Zsb3cgc2NvcGVkIHRvIHRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGF0IHdpbGwgYmUgZXhlY3V0ZWQgd2l0aCB0aGlzIHJ1bi4gKi9cbiAgY29uc3Qgd29ya2Zsb3cgPSBuZXcgTm9kZVdvcmtmbG93KHByb2Nlc3MuY3dkKCksIHtcbiAgICBmb3JjZSxcbiAgICBkcnlSdW4sXG4gICAgcmVzb2x2ZVBhdGhzOiBbcHJvY2Vzcy5jd2QoKSwgX19kaXJuYW1lXSxcbiAgICBzY2hlbWFWYWxpZGF0aW9uOiB0cnVlLFxuICB9KTtcblxuICAvKiogSWYgdGhlIHVzZXIgd2FudHMgdG8gbGlzdCBzY2hlbWF0aWNzLCB3ZSBzaW1wbHkgc2hvdyBhbGwgdGhlIHNjaGVtYXRpYyBuYW1lcy4gKi9cbiAgaWYgKGNsaU9wdGlvbnNbJ2xpc3Qtc2NoZW1hdGljcyddKSB7XG4gICAgcmV0dXJuIF9saXN0U2NoZW1hdGljcyh3b3JrZmxvdywgY29sbGVjdGlvbk5hbWUsIGxvZ2dlcik7XG4gIH1cblxuICBpZiAoIXNjaGVtYXRpY05hbWUpIHtcbiAgICBsb2dnZXIuaW5mbyhnZXRVc2FnZSgpKTtcblxuICAgIHJldHVybiAxO1xuICB9XG5cbiAgaWYgKGRlYnVnKSB7XG4gICAgbG9nZ2VyLmluZm8oXG4gICAgICBgRGVidWcgbW9kZSBlbmFibGVkJHtpc0xvY2FsQ29sbGVjdGlvbiA/ICcgYnkgZGVmYXVsdCBmb3IgbG9jYWwgY29sbGVjdGlvbnMnIDogJyd9LmAsXG4gICAgKTtcbiAgfVxuXG4gIC8vIEluZGljYXRlIHRvIHRoZSB1c2VyIHdoZW4gbm90aGluZyBoYXMgYmVlbiBkb25lLiBUaGlzIGlzIGF1dG9tYXRpY2FsbHkgc2V0IHRvIG9mZiB3aGVuIHRoZXJlJ3NcbiAgLy8gYSBuZXcgRHJ5UnVuRXZlbnQuXG4gIGxldCBub3RoaW5nRG9uZSA9IHRydWU7XG5cbiAgLy8gTG9nZ2luZyBxdWV1ZSB0aGF0IHJlY2VpdmVzIGFsbCB0aGUgbWVzc2FnZXMgdG8gc2hvdyB0aGUgdXNlcnMuIFRoaXMgb25seSBnZXQgc2hvd24gd2hlbiBub1xuICAvLyBlcnJvcnMgaGFwcGVuZWQuXG4gIGxldCBsb2dnaW5nUXVldWU6IHN0cmluZ1tdID0gW107XG4gIGxldCBlcnJvciA9IGZhbHNlO1xuXG4gIC8qKlxuICAgKiBMb2dzIG91dCBkcnkgcnVuIGV2ZW50cy5cbiAgICpcbiAgICogQWxsIGV2ZW50cyB3aWxsIGFsd2F5cyBiZSBleGVjdXRlZCBoZXJlLCBpbiBvcmRlciBvZiBkaXNjb3ZlcnkuIFRoYXQgbWVhbnMgdGhhdCBhbiBlcnJvciB3b3VsZFxuICAgKiBiZSBzaG93biBhbG9uZyBvdGhlciBldmVudHMgd2hlbiBpdCBoYXBwZW5zLiBTaW5jZSBlcnJvcnMgaW4gd29ya2Zsb3dzIHdpbGwgc3RvcCB0aGUgT2JzZXJ2YWJsZVxuICAgKiBmcm9tIGNvbXBsZXRpbmcgc3VjY2Vzc2Z1bGx5LCB3ZSByZWNvcmQgYW55IGV2ZW50cyBvdGhlciB0aGFuIGVycm9ycywgdGhlbiBvbiBjb21wbGV0aW9uIHdlXG4gICAqIHNob3cgdGhlbS5cbiAgICpcbiAgICogVGhpcyBpcyBhIHNpbXBsZSB3YXkgdG8gb25seSBzaG93IGVycm9ycyB3aGVuIGFuIGVycm9yIG9jY3VyLlxuICAgKi9cbiAgd29ya2Zsb3cucmVwb3J0ZXIuc3Vic2NyaWJlKChldmVudCkgPT4ge1xuICAgIG5vdGhpbmdEb25lID0gZmFsc2U7XG4gICAgLy8gU3RyaXAgbGVhZGluZyBzbGFzaCB0byBwcmV2ZW50IGNvbmZ1c2lvbi5cbiAgICBjb25zdCBldmVudFBhdGggPSBldmVudC5wYXRoLnN0YXJ0c1dpdGgoJy8nKSA/IGV2ZW50LnBhdGguc2xpY2UoMSkgOiBldmVudC5wYXRoO1xuXG4gICAgc3dpdGNoIChldmVudC5raW5kKSB7XG4gICAgICBjYXNlICdlcnJvcic6XG4gICAgICAgIGVycm9yID0gdHJ1ZTtcblxuICAgICAgICBjb25zdCBkZXNjID0gZXZlbnQuZGVzY3JpcHRpb24gPT0gJ2FscmVhZHlFeGlzdCcgPyAnYWxyZWFkeSBleGlzdHMnIDogJ2RvZXMgbm90IGV4aXN0JztcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBFUlJPUiEgJHtldmVudFBhdGh9ICR7ZGVzY30uYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndXBkYXRlJzpcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7Y29sb3JzLmN5YW4oJ1VQREFURScpfSAke2V2ZW50UGF0aH0gKCR7ZXZlbnQuY29udGVudC5sZW5ndGh9IGJ5dGVzKWApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke2NvbG9ycy5ncmVlbignQ1JFQVRFJyl9ICR7ZXZlbnRQYXRofSAoJHtldmVudC5jb250ZW50Lmxlbmd0aH0gYnl0ZXMpYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7Y29sb3JzLnllbGxvdygnREVMRVRFJyl9ICR7ZXZlbnRQYXRofWApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3JlbmFtZSc6XG4gICAgICAgIGNvbnN0IGV2ZW50VG9QYXRoID0gZXZlbnQudG8uc3RhcnRzV2l0aCgnLycpID8gZXZlbnQudG8uc2xpY2UoMSkgOiBldmVudC50bztcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7Y29sb3JzLmJsdWUoJ1JFTkFNRScpfSAke2V2ZW50UGF0aH0gPT4gJHtldmVudFRvUGF0aH1gKTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9KTtcblxuICAvKipcbiAgICogTGlzdGVuIHRvIGxpZmVjeWNsZSBldmVudHMgb2YgdGhlIHdvcmtmbG93IHRvIGZsdXNoIHRoZSBsb2dzIGJldHdlZW4gZWFjaCBwaGFzZXMuXG4gICAqL1xuICB3b3JrZmxvdy5saWZlQ3ljbGUuc3Vic2NyaWJlKChldmVudCkgPT4ge1xuICAgIGlmIChldmVudC5raW5kID09ICd3b3JrZmxvdy1lbmQnIHx8IGV2ZW50LmtpbmQgPT0gJ3Bvc3QtdGFza3Mtc3RhcnQnKSB7XG4gICAgICBpZiAoIWVycm9yKSB7XG4gICAgICAgIC8vIEZsdXNoIHRoZSBsb2cgcXVldWUgYW5kIGNsZWFuIHRoZSBlcnJvciBzdGF0ZS5cbiAgICAgICAgbG9nZ2luZ1F1ZXVlLmZvckVhY2goKGxvZykgPT4gbG9nZ2VyLmluZm8obG9nKSk7XG4gICAgICB9XG5cbiAgICAgIGxvZ2dpbmdRdWV1ZSA9IFtdO1xuICAgICAgZXJyb3IgPSBmYWxzZTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIFNob3cgdXNhZ2Ugb2YgZGVwcmVjYXRlZCBvcHRpb25zXG4gIHdvcmtmbG93LnJlZ2lzdHJ5LnVzZVhEZXByZWNhdGVkUHJvdmlkZXIoKG1zZykgPT4gbG9nZ2VyLndhcm4obXNnKSk7XG5cbiAgLy8gUGFzcyB0aGUgcmVzdCBvZiB0aGUgYXJndW1lbnRzIGFzIHRoZSBzbWFydCBkZWZhdWx0IFwiYXJndlwiLiBUaGVuIGRlbGV0ZSBpdC5cbiAgd29ya2Zsb3cucmVnaXN0cnkuYWRkU21hcnREZWZhdWx0UHJvdmlkZXIoJ2FyZ3YnLCAoc2NoZW1hKSA9PlxuICAgICdpbmRleCcgaW4gc2NoZW1hID8gX1tOdW1iZXIoc2NoZW1hWydpbmRleCddKV0gOiBfLFxuICApO1xuXG4gIC8vIEFkZCBwcm9tcHRzLlxuICBpZiAoY2xpT3B0aW9ucy5pbnRlcmFjdGl2ZSAmJiBpc1RUWSgpKSB7XG4gICAgd29ya2Zsb3cucmVnaXN0cnkudXNlUHJvbXB0UHJvdmlkZXIoX2NyZWF0ZVByb21wdFByb3ZpZGVyKCkpO1xuICB9XG5cbiAgLyoqXG4gICAqICBFeGVjdXRlIHRoZSB3b3JrZmxvdywgd2hpY2ggd2lsbCByZXBvcnQgdGhlIGRyeSBydW4gZXZlbnRzLCBydW4gdGhlIHRhc2tzLCBhbmQgY29tcGxldGVcbiAgICogIGFmdGVyIGFsbCBpcyBkb25lLlxuICAgKlxuICAgKiAgVGhlIE9ic2VydmFibGUgcmV0dXJuZWQgd2lsbCBwcm9wZXJseSBjYW5jZWwgdGhlIHdvcmtmbG93IGlmIHVuc3Vic2NyaWJlZCwgZXJyb3Igb3V0IGlmIEFOWVxuICAgKiAgc3RlcCBvZiB0aGUgd29ya2Zsb3cgZmFpbGVkIChzaW5rIG9yIHRhc2spLCB3aXRoIGRldGFpbHMgaW5jbHVkZWQsIGFuZCB3aWxsIG9ubHkgY29tcGxldGVcbiAgICogIHdoZW4gZXZlcnl0aGluZyBpcyBkb25lLlxuICAgKi9cbiAgdHJ5IHtcbiAgICBhd2FpdCB3b3JrZmxvd1xuICAgICAgLmV4ZWN1dGUoe1xuICAgICAgICBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSxcbiAgICAgICAgc2NoZW1hdGljOiBzY2hlbWF0aWNOYW1lLFxuICAgICAgICBvcHRpb25zOiBzY2hlbWF0aWNPcHRpb25zLFxuICAgICAgICBhbGxvd1ByaXZhdGU6IGFsbG93UHJpdmF0ZSxcbiAgICAgICAgZGVidWc6IGRlYnVnLFxuICAgICAgICBsb2dnZXI6IGxvZ2dlcixcbiAgICAgIH0pXG4gICAgICAudG9Qcm9taXNlKCk7XG5cbiAgICBpZiAobm90aGluZ0RvbmUpIHtcbiAgICAgIGxvZ2dlci5pbmZvKCdOb3RoaW5nIHRvIGJlIGRvbmUuJyk7XG4gICAgfSBlbHNlIGlmIChkcnlSdW4pIHtcbiAgICAgIGxvZ2dlci5pbmZvKFxuICAgICAgICBgRHJ5IHJ1biBlbmFibGVkJHtcbiAgICAgICAgICBkcnlSdW5QcmVzZW50ID8gJycgOiAnIGJ5IGRlZmF1bHQgaW4gZGVidWcgbW9kZSdcbiAgICAgICAgfS4gTm8gZmlsZXMgd3JpdHRlbiB0byBkaXNrLmAsXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiAwO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBpZiAoZXJyIGluc3RhbmNlb2YgVW5zdWNjZXNzZnVsV29ya2Zsb3dFeGVjdXRpb24pIHtcbiAgICAgIC8vIFwiU2VlIGFib3ZlXCIgYmVjYXVzZSB3ZSBhbHJlYWR5IHByaW50ZWQgdGhlIGVycm9yLlxuICAgICAgbG9nZ2VyLmZhdGFsKCdUaGUgU2NoZW1hdGljIHdvcmtmbG93IGZhaWxlZC4gU2VlIGFib3ZlLicpO1xuICAgIH0gZWxzZSBpZiAoZGVidWcgJiYgZXJyIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgIGxvZ2dlci5mYXRhbChgQW4gZXJyb3Igb2NjdXJlZDpcXG4ke2Vyci5zdGFja31gKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbG9nZ2VyLmZhdGFsKGBFcnJvcjogJHtlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogZXJyfWApO1xuICAgIH1cblxuICAgIHJldHVybiAxO1xuICB9XG59XG5cbi8qKlxuICogR2V0IHVzYWdlIG9mIHRoZSBDTEkgdG9vbC5cbiAqL1xuZnVuY3Rpb24gZ2V0VXNhZ2UoKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRhZ3Muc3RyaXBJbmRlbnRgXG4gIHNjaGVtYXRpY3MgW2NvbGxlY3Rpb24tbmFtZTpdc2NoZW1hdGljLW5hbWUgW29wdGlvbnMsIC4uLl1cblxuICBCeSBkZWZhdWx0LCBpZiB0aGUgY29sbGVjdGlvbiBuYW1lIGlzIG5vdCBzcGVjaWZpZWQsIHVzZSB0aGUgaW50ZXJuYWwgY29sbGVjdGlvbiBwcm92aWRlZFxuICBieSB0aGUgU2NoZW1hdGljcyBDTEkuXG5cbiAgT3B0aW9uczpcbiAgICAgIC0tZGVidWcgICAgICAgICAgICAgRGVidWcgbW9kZS4gVGhpcyBpcyB0cnVlIGJ5IGRlZmF1bHQgaWYgdGhlIGNvbGxlY3Rpb24gaXMgYSByZWxhdGl2ZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoIChpbiB0aGF0IGNhc2UsIHR1cm4gb2ZmIHdpdGggLS1kZWJ1Zz1mYWxzZSkuXG5cbiAgICAgIC0tYWxsb3ctcHJpdmF0ZSAgICAgQWxsb3cgcHJpdmF0ZSBzY2hlbWF0aWNzIHRvIGJlIHJ1biBmcm9tIHRoZSBjb21tYW5kIGxpbmUuIERlZmF1bHQgdG9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgZmFsc2UuXG5cbiAgICAgIC0tZHJ5LXJ1biAgICAgICAgICAgRG8gbm90IG91dHB1dCBhbnl0aGluZywgYnV0IGluc3RlYWQganVzdCBzaG93IHdoYXQgYWN0aW9ucyB3b3VsZCBiZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJmb3JtZWQuIERlZmF1bHQgdG8gdHJ1ZSBpZiBkZWJ1ZyBpcyBhbHNvIHRydWUuXG5cbiAgICAgIC0tZm9yY2UgICAgICAgICAgICAgRm9yY2Ugb3ZlcndyaXRpbmcgZmlsZXMgdGhhdCB3b3VsZCBvdGhlcndpc2UgYmUgYW4gZXJyb3IuXG5cbiAgICAgIC0tbGlzdC1zY2hlbWF0aWNzICAgTGlzdCBhbGwgc2NoZW1hdGljcyBmcm9tIHRoZSBjb2xsZWN0aW9uLCBieSBuYW1lLiBBIGNvbGxlY3Rpb24gbmFtZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBzaG91bGQgYmUgc3VmZml4ZWQgYnkgYSBjb2xvbi4gRXhhbXBsZTogJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzLWNsaTonLlxuXG4gICAgICAtLW5vLWludGVyYWN0aXZlICAgIERpc2FibGVzIGludGVyYWN0aXZlIGlucHV0IHByb21wdHMuXG5cbiAgICAgIC0tdmVyYm9zZSAgICAgICAgICAgU2hvdyBtb3JlIGluZm9ybWF0aW9uLlxuXG4gICAgICAtLWhlbHAgICAgICAgICAgICAgIFNob3cgdGhpcyBtZXNzYWdlLlxuXG4gIEFueSBhZGRpdGlvbmFsIG9wdGlvbiBpcyBwYXNzZWQgdG8gdGhlIFNjaGVtYXRpY3MgZGVwZW5kaW5nIG9uIGl0cyBzY2hlbWEuXG4gIGA7XG59XG5cbi8qKiBQYXJzZSB0aGUgY29tbWFuZCBsaW5lLiAqL1xuY29uc3QgYm9vbGVhbkFyZ3MgPSBbXG4gICdhbGxvdy1wcml2YXRlJyxcbiAgJ2RlYnVnJyxcbiAgJ2RyeS1ydW4nLFxuICAnZm9yY2UnLFxuICAnaGVscCcsXG4gICdsaXN0LXNjaGVtYXRpY3MnLFxuICAndmVyYm9zZScsXG4gICdpbnRlcmFjdGl2ZScsXG5dIGFzIGNvbnN0O1xuXG50eXBlIEVsZW1lbnRUeXBlPFQgZXh0ZW5kcyBSZWFkb25seUFycmF5PHVua25vd24+PiA9IFQgZXh0ZW5kcyBSZWFkb25seUFycmF5PGluZmVyIEVsZW1lbnRUeXBlPlxuICA/IEVsZW1lbnRUeXBlXG4gIDogbmV2ZXI7XG5cbmludGVyZmFjZSBPcHRpb25zIHtcbiAgXzogc3RyaW5nW107XG4gIHNjaGVtYXRpY09wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBjbGlPcHRpb25zOiBQYXJ0aWFsPFJlY29yZDxFbGVtZW50VHlwZTx0eXBlb2YgYm9vbGVhbkFyZ3M+LCBib29sZWFuIHwgbnVsbD4+O1xufVxuXG4vKiogUGFyc2UgdGhlIGNvbW1hbmQgbGluZS4gKi9cbmZ1bmN0aW9uIHBhcnNlQXJncyhhcmdzOiBzdHJpbmdbXSk6IE9wdGlvbnMge1xuICBjb25zdCB7IF8sIC4uLm9wdGlvbnMgfSA9IHlhcmdzUGFyc2VyKGFyZ3MsIHtcbiAgICBib29sZWFuOiBib29sZWFuQXJncyBhcyB1bmtub3duIGFzIHN0cmluZ1tdLFxuICAgIGRlZmF1bHQ6IHtcbiAgICAgICdpbnRlcmFjdGl2ZSc6IHRydWUsXG4gICAgICAnZGVidWcnOiBudWxsLFxuICAgICAgJ2RyeS1ydW4nOiBudWxsLFxuICAgIH0sXG4gICAgY29uZmlndXJhdGlvbjoge1xuICAgICAgJ2RvdC1ub3RhdGlvbic6IGZhbHNlLFxuICAgICAgJ2Jvb2xlYW4tbmVnYXRpb24nOiB0cnVlLFxuICAgICAgJ3N0cmlwLWFsaWFzZWQnOiB0cnVlLFxuICAgICAgJ2NhbWVsLWNhc2UtZXhwYW5zaW9uJzogZmFsc2UsXG4gICAgfSxcbiAgfSk7XG5cbiAgLy8gQ2FtZWxpemUgb3B0aW9ucyBhcyB5YXJncyB3aWxsIHJldHVybiB0aGUgb2JqZWN0IGluIGtlYmFiLWNhc2Ugd2hlbiBjYW1lbCBjYXNpbmcgaXMgZGlzYWJsZWQuXG4gIGNvbnN0IHNjaGVtYXRpY09wdGlvbnM6IE9wdGlvbnNbJ3NjaGVtYXRpY09wdGlvbnMnXSA9IHt9O1xuICBjb25zdCBjbGlPcHRpb25zOiBPcHRpb25zWydjbGlPcHRpb25zJ10gPSB7fTtcblxuICBjb25zdCBpc0NsaU9wdGlvbnMgPSAoXG4gICAga2V5OiBFbGVtZW50VHlwZTx0eXBlb2YgYm9vbGVhbkFyZ3M+IHwgc3RyaW5nLFxuICApOiBrZXkgaXMgRWxlbWVudFR5cGU8dHlwZW9mIGJvb2xlYW5BcmdzPiA9PlxuICAgIGJvb2xlYW5BcmdzLmluY2x1ZGVzKGtleSBhcyBFbGVtZW50VHlwZTx0eXBlb2YgYm9vbGVhbkFyZ3M+KTtcblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhvcHRpb25zKSkge1xuICAgIGlmICgvW0EtWl0vLnRlc3Qoa2V5KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGFyZ3VtZW50ICR7a2V5fS4gRGlkIHlvdSBtZWFuICR7ZGVjYW1lbGl6ZShrZXkpfT9gKTtcbiAgICB9XG5cbiAgICBpZiAoaXNDbGlPcHRpb25zKGtleSkpIHtcbiAgICAgIGNsaU9wdGlvbnNba2V5XSA9IHZhbHVlO1xuICAgIH0gZWxzZSB7XG4gICAgICBzY2hlbWF0aWNPcHRpb25zW2NhbWVsQ2FzZShrZXkpXSA9IHZhbHVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgXzogXy5tYXAoKHYpID0+IHYudG9TdHJpbmcoKSksXG4gICAgc2NoZW1hdGljT3B0aW9ucyxcbiAgICBjbGlPcHRpb25zLFxuICB9O1xufVxuXG5mdW5jdGlvbiBpc1RUWSgpOiBib29sZWFuIHtcbiAgY29uc3QgaXNUcnV0aHkgPSAodmFsdWU6IHVuZGVmaW5lZCB8IHN0cmluZykgPT4ge1xuICAgIC8vIFJldHVybnMgdHJ1ZSBpZiB2YWx1ZSBpcyBhIHN0cmluZyB0aGF0IGlzIGFueXRoaW5nIGJ1dCAwIG9yIGZhbHNlLlxuICAgIHJldHVybiB2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSAnMCcgJiYgdmFsdWUudG9VcHBlckNhc2UoKSAhPT0gJ0ZBTFNFJztcbiAgfTtcblxuICAvLyBJZiB3ZSBmb3JjZSBUVFksIHdlIGFsd2F5cyByZXR1cm4gdHJ1ZS5cbiAgY29uc3QgZm9yY2UgPSBwcm9jZXNzLmVudlsnTkdfRk9SQ0VfVFRZJ107XG4gIGlmIChmb3JjZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGlzVHJ1dGh5KGZvcmNlKTtcbiAgfVxuXG4gIHJldHVybiAhIXByb2Nlc3Muc3Rkb3V0LmlzVFRZICYmICFpc1RydXRoeShwcm9jZXNzLmVudlsnQ0knXSk7XG59XG5cbmlmIChyZXF1aXJlLm1haW4gPT09IG1vZHVsZSkge1xuICBjb25zdCBhcmdzID0gcHJvY2Vzcy5hcmd2LnNsaWNlKDIpO1xuICBtYWluKHsgYXJncyB9KVxuICAgIC50aGVuKChleGl0Q29kZSkgPT4gKHByb2Nlc3MuZXhpdENvZGUgPSBleGl0Q29kZSkpXG4gICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICB0aHJvdyBlO1xuICAgIH0pO1xufVxuIl19