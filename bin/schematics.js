#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("symbol-observable");
// symbol polyfill must go first
// tslint:disable-next-line:ordered-imports import-groups
const core_1 = require("@angular-devkit/core");
const node_1 = require("@angular-devkit/core/node");
const schematics_1 = require("@angular-devkit/schematics");
const tools_1 = require("@angular-devkit/schematics/tools");
const minimist = require("minimist");
/**
 * Show usage of the CLI tool, and exit the process.
 */
function usage(exitCode = 0) {
    logger.info(core_1.tags.stripIndent `
    schematics [CollectionName:]SchematicName [options, ...]

    By default, if the collection name is not specified, use the internal collection provided
    by the Schematics CLI.

    Options:
        --debug             Debug mode. This is true by default if the collection is a relative
                            path (in that case, turn off with --debug=false).
        --allowPrivate      Allow private schematics to be run from the command line. Default to
                            false.
        --dry-run           Do not output anything, but instead just show what actions would be
                            performed. Default to true if debug is also true.
        --force             Force overwriting files that would otherwise be an error.
        --list-schematics   List all schematics from the collection, by name.
        --verbose           Show more information.

        --help              Show this message.

    Any additional option is passed to the Schematics depending on
  `);
    process.exit(exitCode);
    throw 0; // The node typing sometimes don't have a never type for process.exit().
}
/**
 * Parse the name of schematic passed in argument, and return a {collection, schematic} named
 * tuple. The user can pass in `collection-name:schematic-name`, and this function will either
 * return `{collection: 'collection-name', schematic: 'schematic-name'}`, or it will error out
 * and show usage.
 *
 * In the case where a collection name isn't part of the argument, the default is to use the
 * schematics package (@schematics/schematics) as the collection.
 *
 * This logic is entirely up to the tooling.
 *
 * @param str The argument to parse.
 * @return {{collection: string, schematic: (string)}}
 */
function parseSchematicName(str) {
    let collection = '@schematics/schematics';
    if (!str || str === null) {
        usage(1);
    }
    let schematic = str;
    if (schematic.indexOf(':') != -1) {
        [collection, schematic] = schematic.split(':', 2);
        if (!schematic) {
            usage(2);
        }
    }
    return { collection, schematic };
}
/** Parse the command line. */
const booleanArgs = [
    'allowPrivate',
    'debug',
    'dry-run',
    'force',
    'help',
    'list-schematics',
    'verbose',
];
const argv = minimist(process.argv.slice(2), {
    boolean: booleanArgs,
    default: {
        'debug': null,
        'dry-run': null,
    },
    '--': true,
});
/** Create the DevKit Logger used through the CLI. */
const logger = node_1.createConsoleLogger(argv['verbose']);
if (argv.help) {
    usage();
}
/** Get the collection an schematic name from the first argument. */
const { collection: collectionName, schematic: schematicName, } = parseSchematicName(argv._.shift() || null);
const isLocalCollection = collectionName.startsWith('.') || collectionName.startsWith('/');
/** If the user wants to list schematics, we simply show all the schematic names. */
if (argv['list-schematics']) {
    // logger.info(engine.listSchematicNames(collection).join('\n'));
    process.exit(0);
    throw 0; // TypeScript doesn't know that process.exit() never returns.
}
/** Gather the arguments for later use. */
const debug = argv.debug === null ? isLocalCollection : argv.debug;
const dryRun = argv['dry-run'] === null ? debug : argv['dry-run'];
const force = argv['force'];
const allowPrivate = argv['allowPrivate'];
/** Create a Virtual FS Host scoped to where the process is being run. **/
const fsHost = new core_1.virtualFs.ScopedHost(new node_1.NodeJsSyncHost(), core_1.normalize(process.cwd()));
/** Create the workflow that will be executed with this run. */
const workflow = new tools_1.NodeWorkflow(fsHost, { force, dryRun });
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
    switch (event.kind) {
        case 'error':
            error = true;
            const desc = event.description == 'alreadyExist' ? 'already exists' : 'does not exist';
            logger.warn(`ERROR! ${event.path} ${desc}.`);
            break;
        case 'update':
            loggingQueue.push(core_1.tags.oneLine `
        ${core_1.terminal.white('UPDATE')} ${event.path} (${event.content.length} bytes)
      `);
            break;
        case 'create':
            loggingQueue.push(core_1.tags.oneLine `
        ${core_1.terminal.green('CREATE')} ${event.path} (${event.content.length} bytes)
      `);
            break;
        case 'delete':
            loggingQueue.push(`${core_1.terminal.yellow('DELETE')} ${event.path}`);
            break;
        case 'rename':
            loggingQueue.push(`${core_1.terminal.blue('RENAME')} ${event.path} => ${event.to}`);
            break;
    }
});
/**
 * Listen to lifecycle events of the workflow to flush the logs between each phases.
 */
workflow.lifeCycle.subscribe(event => {
    if (event.kind == 'workflow-end' || event.kind == 'post-tasks-start') {
        if (!error) {
            // Flush the log queue and clean the error state.
            loggingQueue.forEach(log => logger.info(log));
        }
        loggingQueue = [];
        error = false;
    }
});
/**
 * Remove every options from argv that we support in schematics itself.
 */
const args = Object.assign({}, argv);
delete args['--'];
for (const key of booleanArgs) {
    delete args[key];
}
/**
 * Add options from `--` to args.
 */
const argv2 = minimist(argv['--']);
for (const key of Object.keys(argv2)) {
    args[key] = argv2[key];
}
// Pass the rest of the arguments as the smart default "argv". Then delete it.
workflow.registry.addSmartDefaultProvider('argv', (schema) => {
    if ('index' in schema) {
        return argv._[Number(schema['index'])];
    }
    else {
        return argv._;
    }
});
delete args._;
/**
 *  Execute the workflow, which will report the dry run events, run the tasks, and complete
 *  after all is done.
 *
 *  The Observable returned will properly cancel the workflow if unsubscribed, error out if ANY
 *  step of the workflow failed (sink or task), with details included, and will only complete
 *  when everything is done.
 */
workflow.execute({
    collection: collectionName,
    schematic: schematicName,
    options: args,
    allowPrivate: allowPrivate,
    debug: debug,
    logger: logger,
})
    .subscribe({
    error(err) {
        // In case the workflow was not successful, show an appropriate error message.
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
        process.exit(1);
    },
    complete() {
        if (nothingDone) {
            logger.info('Nothing to be done.');
        }
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIuLyIsInNvdXJjZXMiOlsicGFja2FnZXMvYW5ndWxhcl9kZXZraXQvc2NoZW1hdGljc19jbGkvYmluL3NjaGVtYXRpY3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBU0EsNkJBQTJCO0FBQzNCLGdDQUFnQztBQUNoQyx5REFBeUQ7QUFDekQsK0NBTThCO0FBQzlCLG9EQUFnRjtBQUNoRiwyREFBd0Y7QUFDeEYsNERBQWdFO0FBQ2hFLHFDQUFxQztBQUdyQzs7R0FFRztBQUNILGVBQWUsUUFBUSxHQUFHLENBQUM7SUFDekIsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFJLENBQUMsV0FBVyxDQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW9CM0IsQ0FBQyxDQUFDO0lBRUgsT0FBTyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUN2QixNQUFNLENBQUMsQ0FBQyxDQUFFLHdFQUF3RTtBQUNwRixDQUFDO0FBR0Q7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILDRCQUE0QixHQUFrQjtJQUM1QyxJQUFJLFVBQVUsR0FBRyx3QkFBd0IsQ0FBQztJQUUxQyxJQUFJLENBQUMsR0FBRyxJQUFJLEdBQUcsS0FBSyxJQUFJLEVBQUU7UUFDeEIsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0tBQ1Y7SUFFRCxJQUFJLFNBQVMsR0FBVyxHQUFhLENBQUM7SUFDdEMsSUFBSSxTQUFTLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFO1FBQ2hDLENBQUMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBRWxELElBQUksQ0FBQyxTQUFTLEVBQUU7WUFDZCxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7U0FDVjtLQUNGO0lBRUQsT0FBTyxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsQ0FBQztBQUNuQyxDQUFD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WSxFQUFFLFlBQVk7SUFDMUIsS0FBSyxFQUFFLEtBQUs7SUFDWixNQUFNLEVBQUUsTUFBTTtDQUNmLENBQUM7S0FDRCxTQUFTLENBQUM7SUFDVCxLQUFLLENBQUMsR0FBVTtRQUNkLDhFQUE4RTtRQUM5RSxJQUFJLEdBQUcsWUFBWSwwQ0FBNkIsRUFBRTtZQUNoRCxvREFBb0Q7WUFDcEQsTUFBTSxDQUFDLEtBQUssQ0FBQywyQ0FBMkMsQ0FBQyxDQUFDO1NBQzNEO2FBQU0sSUFBSSxLQUFLLEVBQUU7WUFDaEIsTUFBTSxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUM7U0FDakQ7YUFBTTtZQUNMLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEtBQUssSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7U0FDeEM7UUFFRCxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ2xCLENBQUM7SUFDRCxRQUFRO1FBQ04sSUFBSSxXQUFXLEVBQUU7WUFDZixNQUFNLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLENBQUM7U0FDcEM7SUFDSCxDQUFDO0NBQ0YsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgJ3N5bWJvbC1vYnNlcnZhYmxlJztcbi8vIHN5bWJvbCBwb2x5ZmlsbCBtdXN0IGdvIGZpcnN0XG4vLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6b3JkZXJlZC1pbXBvcnRzIGltcG9ydC1ncm91cHNcbmltcG9ydCB7XG4gIEpzb25PYmplY3QsXG4gIG5vcm1hbGl6ZSxcbiAgdGFncyxcbiAgdGVybWluYWwsXG4gIHZpcnR1YWxGcyxcbn0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgTm9kZUpzU3luY0hvc3QsIGNyZWF0ZUNvbnNvbGVMb2dnZXIgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZS9ub2RlJztcbmltcG9ydCB7IERyeVJ1bkV2ZW50LCBVbnN1Y2Nlc3NmdWxXb3JrZmxvd0V4ZWN1dGlvbiB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzJztcbmltcG9ydCB7IE5vZGVXb3JrZmxvdyB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzL3Rvb2xzJztcbmltcG9ydCAqIGFzIG1pbmltaXN0IGZyb20gJ21pbmltaXN0JztcblxuXG4vKipcbiAqIFNob3cgdXNhZ2Ugb2YgdGhlIENMSSB0b29sLCBhbmQgZXhpdCB0aGUgcHJvY2Vzcy5cbiAqL1xuZnVuY3Rpb24gdXNhZ2UoZXhpdENvZGUgPSAwKTogbmV2ZXIge1xuICBsb2dnZXIuaW5mbyh0YWdzLnN0cmlwSW5kZW50YFxuICAgIHNjaGVtYXRpY3MgW0NvbGxlY3Rpb25OYW1lOl1TY2hlbWF0aWNOYW1lIFtvcHRpb25zLCAuLi5dXG5cbiAgICBCeSBkZWZhdWx0LCBpZiB0aGUgY29sbGVjdGlvbiBuYW1lIGlzIG5vdCBzcGVjaWZpZWQsIHVzZSB0aGUgaW50ZXJuYWwgY29sbGVjdGlvbiBwcm92aWRlZFxuICAgIGJ5IHRoZSBTY2hlbWF0aWNzIENMSS5cblxuICAgIE9wdGlvbnM6XG4gICAgICAgIC0tZGVidWcgICAgICAgICAgICAgRGVidWcgbW9kZS4gVGhpcyBpcyB0cnVlIGJ5IGRlZmF1bHQgaWYgdGhlIGNvbGxlY3Rpb24gaXMgYSByZWxhdGl2ZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGggKGluIHRoYXQgY2FzZSwgdHVybiBvZmYgd2l0aCAtLWRlYnVnPWZhbHNlKS5cbiAgICAgICAgLS1hbGxvd1ByaXZhdGUgICAgICBBbGxvdyBwcml2YXRlIHNjaGVtYXRpY3MgdG8gYmUgcnVuIGZyb20gdGhlIGNvbW1hbmQgbGluZS4gRGVmYXVsdCB0b1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZhbHNlLlxuICAgICAgICAtLWRyeS1ydW4gICAgICAgICAgIERvIG5vdCBvdXRwdXQgYW55dGhpbmcsIGJ1dCBpbnN0ZWFkIGp1c3Qgc2hvdyB3aGF0IGFjdGlvbnMgd291bGQgYmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJmb3JtZWQuIERlZmF1bHQgdG8gdHJ1ZSBpZiBkZWJ1ZyBpcyBhbHNvIHRydWUuXG4gICAgICAgIC0tZm9yY2UgICAgICAgICAgICAgRm9yY2Ugb3ZlcndyaXRpbmcgZmlsZXMgdGhhdCB3b3VsZCBvdGhlcndpc2UgYmUgYW4gZXJyb3IuXG4gICAgICAgIC0tbGlzdC1zY2hlbWF0aWNzICAgTGlzdCBhbGwgc2NoZW1hdGljcyBmcm9tIHRoZSBjb2xsZWN0aW9uLCBieSBuYW1lLlxuICAgICAgICAtLXZlcmJvc2UgICAgICAgICAgIFNob3cgbW9yZSBpbmZvcm1hdGlvbi5cblxuICAgICAgICAtLWhlbHAgICAgICAgICAgICAgIFNob3cgdGhpcyBtZXNzYWdlLlxuXG4gICAgQW55IGFkZGl0aW9uYWwgb3B0aW9uIGlzIHBhc3NlZCB0byB0aGUgU2NoZW1hdGljcyBkZXBlbmRpbmcgb25cbiAgYCk7XG5cbiAgcHJvY2Vzcy5leGl0KGV4aXRDb2RlKTtcbiAgdGhyb3cgMDsgIC8vIFRoZSBub2RlIHR5cGluZyBzb21ldGltZXMgZG9uJ3QgaGF2ZSBhIG5ldmVyIHR5cGUgZm9yIHByb2Nlc3MuZXhpdCgpLlxufVxuXG5cbi8qKlxuICogUGFyc2UgdGhlIG5hbWUgb2Ygc2NoZW1hdGljIHBhc3NlZCBpbiBhcmd1bWVudCwgYW5kIHJldHVybiBhIHtjb2xsZWN0aW9uLCBzY2hlbWF0aWN9IG5hbWVkXG4gKiB0dXBsZS4gVGhlIHVzZXIgY2FuIHBhc3MgaW4gYGNvbGxlY3Rpb24tbmFtZTpzY2hlbWF0aWMtbmFtZWAsIGFuZCB0aGlzIGZ1bmN0aW9uIHdpbGwgZWl0aGVyXG4gKiByZXR1cm4gYHtjb2xsZWN0aW9uOiAnY29sbGVjdGlvbi1uYW1lJywgc2NoZW1hdGljOiAnc2NoZW1hdGljLW5hbWUnfWAsIG9yIGl0IHdpbGwgZXJyb3Igb3V0XG4gKiBhbmQgc2hvdyB1c2FnZS5cbiAqXG4gKiBJbiB0aGUgY2FzZSB3aGVyZSBhIGNvbGxlY3Rpb24gbmFtZSBpc24ndCBwYXJ0IG9mIHRoZSBhcmd1bWVudCwgdGhlIGRlZmF1bHQgaXMgdG8gdXNlIHRoZVxuICogc2NoZW1hdGljcyBwYWNrYWdlIChAc2NoZW1hdGljcy9zY2hlbWF0aWNzKSBhcyB0aGUgY29sbGVjdGlvbi5cbiAqXG4gKiBUaGlzIGxvZ2ljIGlzIGVudGlyZWx5IHVwIHRvIHRoZSB0b29saW5nLlxuICpcbiAqIEBwYXJhbSBzdHIgVGhlIGFyZ3VtZW50IHRvIHBhcnNlLlxuICogQHJldHVybiB7e2NvbGxlY3Rpb246IHN0cmluZywgc2NoZW1hdGljOiAoc3RyaW5nKX19XG4gKi9cbmZ1bmN0aW9uIHBhcnNlU2NoZW1hdGljTmFtZShzdHI6IHN0cmluZyB8IG51bGwpOiB7IGNvbGxlY3Rpb246IHN0cmluZywgc2NoZW1hdGljOiBzdHJpbmcgfSB7XG4gIGxldCBjb2xsZWN0aW9uID0gJ0BzY2hlbWF0aWNzL3NjaGVtYXRpY3MnO1xuXG4gIGlmICghc3RyIHx8IHN0ciA9PT0gbnVsbCkge1xuICAgIHVzYWdlKDEpO1xuICB9XG5cbiAgbGV0IHNjaGVtYXRpYzogc3RyaW5nID0gc3RyIGFzIHN0cmluZztcbiAgaWYgKHNjaGVtYXRpYy5pbmRleE9mKCc6JykgIT0gLTEpIHtcbiAgICBbY29sbGVjdGlvbiwgc2NoZW1hdGljXSA9IHNjaGVtYXRpYy5zcGxpdCgnOicsIDIpO1xuXG4gICAgaWYgKCFzY2hlbWF0aWMpIHtcbiAgICAgIHVzYWdlKDIpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7IGNvbGxlY3Rpb24sIHNjaGVtYXRpYyB9O1xufVxuXG5cbi8qKiBQYXJzZSB0aGUgY29tbWFuZCBsaW5lLiAqL1xuY29uc3QgYm9vbGVhbkFyZ3MgPSBbXG4gICdhbGxvd1ByaXZhdGUnLFxuICAnZGVidWcnLFxuICAnZHJ5LXJ1bicsXG4gICdmb3JjZScsXG4gICdoZWxwJyxcbiAgJ2xpc3Qtc2NoZW1hdGljcycsXG4gICd2ZXJib3NlJyxcbl07XG5jb25zdCBhcmd2ID0gbWluaW1pc3QocHJvY2Vzcy5hcmd2LnNsaWNlKDIpLCB7XG4gIGJvb2xlYW46IGJvb2xlYW5BcmdzLFxuICBkZWZhdWx0OiB7XG4gICAgJ2RlYnVnJzogbnVsbCxcbiAgICAnZHJ5LXJ1bic6IG51bGwsXG4gIH0sXG4gICctLSc6IHRydWUsXG59KTtcblxuLyoqIENyZWF0ZSB0aGUgRGV2S2l0IExvZ2dlciB1c2VkIHRocm91Z2ggdGhlIENMSS4gKi9cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUNvbnNvbGVMb2dnZXIoYXJndlsndmVyYm9zZSddKTtcblxuaWYgKGFyZ3YuaGVscCkge1xuICB1c2FnZSgpO1xufVxuXG4vKiogR2V0IHRoZSBjb2xsZWN0aW9uIGFuIHNjaGVtYXRpYyBuYW1lIGZyb20gdGhlIGZpcnN0IGFyZ3VtZW50LiAqL1xuY29uc3Qge1xuICBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSxcbiAgc2NoZW1hdGljOiBzY2hlbWF0aWNOYW1lLFxufSA9IHBhcnNlU2NoZW1hdGljTmFtZShhcmd2Ll8uc2hpZnQoKSB8fCBudWxsKTtcbmNvbnN0IGlzTG9jYWxDb2xsZWN0aW9uID0gY29sbGVjdGlvbk5hbWUuc3RhcnRzV2l0aCgnLicpIHx8IGNvbGxlY3Rpb25OYW1lLnN0YXJ0c1dpdGgoJy8nKTtcblxuXG4vKiogSWYgdGhlIHVzZXIgd2FudHMgdG8gbGlzdCBzY2hlbWF0aWNzLCB3ZSBzaW1wbHkgc2hvdyBhbGwgdGhlIHNjaGVtYXRpYyBuYW1lcy4gKi9cbmlmIChhcmd2WydsaXN0LXNjaGVtYXRpY3MnXSkge1xuICAvLyBsb2dnZXIuaW5mbyhlbmdpbmUubGlzdFNjaGVtYXRpY05hbWVzKGNvbGxlY3Rpb24pLmpvaW4oJ1xcbicpKTtcbiAgcHJvY2Vzcy5leGl0KDApO1xuICB0aHJvdyAwOyAgLy8gVHlwZVNjcmlwdCBkb2Vzbid0IGtub3cgdGhhdCBwcm9jZXNzLmV4aXQoKSBuZXZlciByZXR1cm5zLlxufVxuXG5cbi8qKiBHYXRoZXIgdGhlIGFyZ3VtZW50cyBmb3IgbGF0ZXIgdXNlLiAqL1xuY29uc3QgZGVidWc6IGJvb2xlYW4gPSBhcmd2LmRlYnVnID09PSBudWxsID8gaXNMb2NhbENvbGxlY3Rpb24gOiBhcmd2LmRlYnVnO1xuY29uc3QgZHJ5UnVuOiBib29sZWFuID0gYXJndlsnZHJ5LXJ1biddID09PSBudWxsID8gZGVidWcgOiBhcmd2WydkcnktcnVuJ107XG5jb25zdCBmb3JjZSA9IGFyZ3ZbJ2ZvcmNlJ107XG5jb25zdCBhbGxvd1ByaXZhdGUgPSBhcmd2WydhbGxvd1ByaXZhdGUnXTtcblxuLyoqIENyZWF0ZSBhIFZpcnR1YWwgRlMgSG9zdCBzY29wZWQgdG8gd2hlcmUgdGhlIHByb2Nlc3MgaXMgYmVpbmcgcnVuLiAqKi9cbmNvbnN0IGZzSG9zdCA9IG5ldyB2aXJ0dWFsRnMuU2NvcGVkSG9zdChuZXcgTm9kZUpzU3luY0hvc3QoKSwgbm9ybWFsaXplKHByb2Nlc3MuY3dkKCkpKTtcblxuLyoqIENyZWF0ZSB0aGUgd29ya2Zsb3cgdGhhdCB3aWxsIGJlIGV4ZWN1dGVkIHdpdGggdGhpcyBydW4uICovXG5jb25zdCB3b3JrZmxvdyA9IG5ldyBOb2RlV29ya2Zsb3coZnNIb3N0LCB7IGZvcmNlLCBkcnlSdW4gfSk7XG5cbi8vIEluZGljYXRlIHRvIHRoZSB1c2VyIHdoZW4gbm90aGluZyBoYXMgYmVlbiBkb25lLiBUaGlzIGlzIGF1dG9tYXRpY2FsbHkgc2V0IHRvIG9mZiB3aGVuIHRoZXJlJ3Ncbi8vIGEgbmV3IERyeVJ1bkV2ZW50LlxubGV0IG5vdGhpbmdEb25lID0gdHJ1ZTtcblxuLy8gTG9nZ2luZyBxdWV1ZSB0aGF0IHJlY2VpdmVzIGFsbCB0aGUgbWVzc2FnZXMgdG8gc2hvdyB0aGUgdXNlcnMuIFRoaXMgb25seSBnZXQgc2hvd24gd2hlbiBub1xuLy8gZXJyb3JzIGhhcHBlbmVkLlxubGV0IGxvZ2dpbmdRdWV1ZTogc3RyaW5nW10gPSBbXTtcbmxldCBlcnJvciA9IGZhbHNlO1xuXG4vKipcbiAqIExvZ3Mgb3V0IGRyeSBydW4gZXZlbnRzLlxuICpcbiAqIEFsbCBldmVudHMgd2lsbCBhbHdheXMgYmUgZXhlY3V0ZWQgaGVyZSwgaW4gb3JkZXIgb2YgZGlzY292ZXJ5LiBUaGF0IG1lYW5zIHRoYXQgYW4gZXJyb3Igd291bGRcbiAqIGJlIHNob3duIGFsb25nIG90aGVyIGV2ZW50cyB3aGVuIGl0IGhhcHBlbnMuIFNpbmNlIGVycm9ycyBpbiB3b3JrZmxvd3Mgd2lsbCBzdG9wIHRoZSBPYnNlcnZhYmxlXG4gKiBmcm9tIGNvbXBsZXRpbmcgc3VjY2Vzc2Z1bGx5LCB3ZSByZWNvcmQgYW55IGV2ZW50cyBvdGhlciB0aGFuIGVycm9ycywgdGhlbiBvbiBjb21wbGV0aW9uIHdlXG4gKiBzaG93IHRoZW0uXG4gKlxuICogVGhpcyBpcyBhIHNpbXBsZSB3YXkgdG8gb25seSBzaG93IGVycm9ycyB3aGVuIGFuIGVycm9yIG9jY3VyLlxuICovXG53b3JrZmxvdy5yZXBvcnRlci5zdWJzY3JpYmUoKGV2ZW50OiBEcnlSdW5FdmVudCkgPT4ge1xuICBub3RoaW5nRG9uZSA9IGZhbHNlO1xuXG4gIHN3aXRjaCAoZXZlbnQua2luZCkge1xuICAgIGNhc2UgJ2Vycm9yJzpcbiAgICAgIGVycm9yID0gdHJ1ZTtcblxuICAgICAgY29uc3QgZGVzYyA9IGV2ZW50LmRlc2NyaXB0aW9uID09ICdhbHJlYWR5RXhpc3QnID8gJ2FscmVhZHkgZXhpc3RzJyA6ICdkb2VzIG5vdCBleGlzdCc7XG4gICAgICBsb2dnZXIud2FybihgRVJST1IhICR7ZXZlbnQucGF0aH0gJHtkZXNjfS5gKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICBsb2dnaW5nUXVldWUucHVzaCh0YWdzLm9uZUxpbmVgXG4gICAgICAgICR7dGVybWluYWwud2hpdGUoJ1VQREFURScpfSAke2V2ZW50LnBhdGh9ICgke2V2ZW50LmNvbnRlbnQubGVuZ3RofSBieXRlcylcbiAgICAgIGApO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKHRhZ3Mub25lTGluZWBcbiAgICAgICAgJHt0ZXJtaW5hbC5ncmVlbignQ1JFQVRFJyl9ICR7ZXZlbnQucGF0aH0gKCR7ZXZlbnQuY29udGVudC5sZW5ndGh9IGJ5dGVzKVxuICAgICAgYCk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdkZWxldGUnOlxuICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7dGVybWluYWwueWVsbG93KCdERUxFVEUnKX0gJHtldmVudC5wYXRofWApO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAncmVuYW1lJzpcbiAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke3Rlcm1pbmFsLmJsdWUoJ1JFTkFNRScpfSAke2V2ZW50LnBhdGh9ID0+ICR7ZXZlbnQudG99YCk7XG4gICAgICBicmVhaztcbiAgfVxufSk7XG5cblxuLyoqXG4gKiBMaXN0ZW4gdG8gbGlmZWN5Y2xlIGV2ZW50cyBvZiB0aGUgd29ya2Zsb3cgdG8gZmx1c2ggdGhlIGxvZ3MgYmV0d2VlbiBlYWNoIHBoYXNlcy5cbiAqL1xud29ya2Zsb3cubGlmZUN5Y2xlLnN1YnNjcmliZShldmVudCA9PiB7XG4gIGlmIChldmVudC5raW5kID09ICd3b3JrZmxvdy1lbmQnIHx8IGV2ZW50LmtpbmQgPT0gJ3Bvc3QtdGFza3Mtc3RhcnQnKSB7XG4gICAgaWYgKCFlcnJvcikge1xuICAgICAgLy8gRmx1c2ggdGhlIGxvZyBxdWV1ZSBhbmQgY2xlYW4gdGhlIGVycm9yIHN0YXRlLlxuICAgICAgbG9nZ2luZ1F1ZXVlLmZvckVhY2gobG9nID0+IGxvZ2dlci5pbmZvKGxvZykpO1xuICAgIH1cblxuICAgIGxvZ2dpbmdRdWV1ZSA9IFtdO1xuICAgIGVycm9yID0gZmFsc2U7XG4gIH1cbn0pO1xuXG5cbi8qKlxuICogUmVtb3ZlIGV2ZXJ5IG9wdGlvbnMgZnJvbSBhcmd2IHRoYXQgd2Ugc3VwcG9ydCBpbiBzY2hlbWF0aWNzIGl0c2VsZi5cbiAqL1xuY29uc3QgYXJncyA9IE9iamVjdC5hc3NpZ24oe30sIGFyZ3YpO1xuZGVsZXRlIGFyZ3NbJy0tJ107XG5mb3IgKGNvbnN0IGtleSBvZiBib29sZWFuQXJncykge1xuICBkZWxldGUgYXJnc1trZXldO1xufVxuXG4vKipcbiAqIEFkZCBvcHRpb25zIGZyb20gYC0tYCB0byBhcmdzLlxuICovXG5jb25zdCBhcmd2MiA9IG1pbmltaXN0KGFyZ3ZbJy0tJ10pO1xuZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoYXJndjIpKSB7XG4gIGFyZ3Nba2V5XSA9IGFyZ3YyW2tleV07XG59XG5cbi8vIFBhc3MgdGhlIHJlc3Qgb2YgdGhlIGFyZ3VtZW50cyBhcyB0aGUgc21hcnQgZGVmYXVsdCBcImFyZ3ZcIi4gVGhlbiBkZWxldGUgaXQuXG53b3JrZmxvdy5yZWdpc3RyeS5hZGRTbWFydERlZmF1bHRQcm92aWRlcignYXJndicsIChzY2hlbWE6IEpzb25PYmplY3QpID0+IHtcbiAgaWYgKCdpbmRleCcgaW4gc2NoZW1hKSB7XG4gICAgcmV0dXJuIGFyZ3YuX1tOdW1iZXIoc2NoZW1hWydpbmRleCddKV07XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGFyZ3YuXztcbiAgfVxufSk7XG5kZWxldGUgYXJncy5fO1xuXG5cbi8qKlxuICogIEV4ZWN1dGUgdGhlIHdvcmtmbG93LCB3aGljaCB3aWxsIHJlcG9ydCB0aGUgZHJ5IHJ1biBldmVudHMsIHJ1biB0aGUgdGFza3MsIGFuZCBjb21wbGV0ZVxuICogIGFmdGVyIGFsbCBpcyBkb25lLlxuICpcbiAqICBUaGUgT2JzZXJ2YWJsZSByZXR1cm5lZCB3aWxsIHByb3Blcmx5IGNhbmNlbCB0aGUgd29ya2Zsb3cgaWYgdW5zdWJzY3JpYmVkLCBlcnJvciBvdXQgaWYgQU5ZXG4gKiAgc3RlcCBvZiB0aGUgd29ya2Zsb3cgZmFpbGVkIChzaW5rIG9yIHRhc2spLCB3aXRoIGRldGFpbHMgaW5jbHVkZWQsIGFuZCB3aWxsIG9ubHkgY29tcGxldGVcbiAqICB3aGVuIGV2ZXJ5dGhpbmcgaXMgZG9uZS5cbiAqL1xud29ya2Zsb3cuZXhlY3V0ZSh7XG4gIGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLFxuICBzY2hlbWF0aWM6IHNjaGVtYXRpY05hbWUsXG4gIG9wdGlvbnM6IGFyZ3MsXG4gIGFsbG93UHJpdmF0ZTogYWxsb3dQcml2YXRlLFxuICBkZWJ1ZzogZGVidWcsXG4gIGxvZ2dlcjogbG9nZ2VyLFxufSlcbi5zdWJzY3JpYmUoe1xuICBlcnJvcihlcnI6IEVycm9yKSB7XG4gICAgLy8gSW4gY2FzZSB0aGUgd29ya2Zsb3cgd2FzIG5vdCBzdWNjZXNzZnVsLCBzaG93IGFuIGFwcHJvcHJpYXRlIGVycm9yIG1lc3NhZ2UuXG4gICAgaWYgKGVyciBpbnN0YW5jZW9mIFVuc3VjY2Vzc2Z1bFdvcmtmbG93RXhlY3V0aW9uKSB7XG4gICAgICAvLyBcIlNlZSBhYm92ZVwiIGJlY2F1c2Ugd2UgYWxyZWFkeSBwcmludGVkIHRoZSBlcnJvci5cbiAgICAgIGxvZ2dlci5mYXRhbCgnVGhlIFNjaGVtYXRpYyB3b3JrZmxvdyBmYWlsZWQuIFNlZSBhYm92ZS4nKTtcbiAgICB9IGVsc2UgaWYgKGRlYnVnKSB7XG4gICAgICBsb2dnZXIuZmF0YWwoJ0FuIGVycm9yIG9jY3VyZWQ6XFxuJyArIGVyci5zdGFjayk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvZ2dlci5mYXRhbChlcnIuc3RhY2sgfHwgZXJyLm1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgfSxcbiAgY29tcGxldGUoKSB7XG4gICAgaWYgKG5vdGhpbmdEb25lKSB7XG4gICAgICBsb2dnZXIuaW5mbygnTm90aGluZyB0byBiZSBkb25lLicpO1xuICAgIH1cbiAgfSxcbn0pO1xuIl19