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
            const desc = event.description == 'alreadyExist' ? 'already exists' : 'does not exist.';
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
            logger.fatal(err.message);
        }
        process.exit(1);
    },
    complete() {
        if (nothingDone) {
            logger.info('Nothing to be done.');
        }
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIuLyIsInNvdXJjZXMiOlsicGFja2FnZXMvYW5ndWxhcl9kZXZraXQvc2NoZW1hdGljc19jbGkvYmluL3NjaGVtYXRpY3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBU0EsNkJBQTJCO0FBQzNCLGdDQUFnQztBQUNoQyx5REFBeUQ7QUFDekQsK0NBTThCO0FBQzlCLG9EQUFnRjtBQUNoRiwyREFBd0Y7QUFDeEYsNERBQWdFO0FBQ2hFLHFDQUFxQztBQUdyQzs7R0FFRztBQUNILGVBQWUsUUFBUSxHQUFHLENBQUM7SUFDekIsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFJLENBQUMsV0FBVyxDQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW9CM0IsQ0FBQyxDQUFDO0lBRUgsT0FBTyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUN2QixNQUFNLENBQUMsQ0FBQyxDQUFFLHdFQUF3RTtBQUNwRixDQUFDO0FBR0Q7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILDRCQUE0QixHQUFrQjtJQUM1QyxJQUFJLFVBQVUsR0FBRyx3QkFBd0IsQ0FBQztJQUUxQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxHQUFHLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQztRQUN6QixLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDWCxDQUFDO0lBRUQsSUFBSSxTQUFTLEdBQVcsR0FBYSxDQUFDO0lBQ3RDLEVBQUUsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2pDLENBQUMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBRWxELEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztZQUNmLEtBQUssQ0FBQyxDQUFDLENBQUMs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QkFBcUIsQ0FBQyxDQUFDO1FBQ3JDLENBQUM7SUFDSCxDQUFDO0NBQ0YsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgJ3N5bWJvbC1vYnNlcnZhYmxlJztcbi8vIHN5bWJvbCBwb2x5ZmlsbCBtdXN0IGdvIGZpcnN0XG4vLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6b3JkZXJlZC1pbXBvcnRzIGltcG9ydC1ncm91cHNcbmltcG9ydCB7XG4gIEpzb25PYmplY3QsXG4gIG5vcm1hbGl6ZSxcbiAgdGFncyxcbiAgdGVybWluYWwsXG4gIHZpcnR1YWxGcyxcbn0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgTm9kZUpzU3luY0hvc3QsIGNyZWF0ZUNvbnNvbGVMb2dnZXIgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZS9ub2RlJztcbmltcG9ydCB7IERyeVJ1bkV2ZW50LCBVbnN1Y2Nlc3NmdWxXb3JrZmxvd0V4ZWN1dGlvbiB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzJztcbmltcG9ydCB7IE5vZGVXb3JrZmxvdyB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzL3Rvb2xzJztcbmltcG9ydCAqIGFzIG1pbmltaXN0IGZyb20gJ21pbmltaXN0JztcblxuXG4vKipcbiAqIFNob3cgdXNhZ2Ugb2YgdGhlIENMSSB0b29sLCBhbmQgZXhpdCB0aGUgcHJvY2Vzcy5cbiAqL1xuZnVuY3Rpb24gdXNhZ2UoZXhpdENvZGUgPSAwKTogbmV2ZXIge1xuICBsb2dnZXIuaW5mbyh0YWdzLnN0cmlwSW5kZW50YFxuICAgIHNjaGVtYXRpY3MgW0NvbGxlY3Rpb25OYW1lOl1TY2hlbWF0aWNOYW1lIFtvcHRpb25zLCAuLi5dXG5cbiAgICBCeSBkZWZhdWx0LCBpZiB0aGUgY29sbGVjdGlvbiBuYW1lIGlzIG5vdCBzcGVjaWZpZWQsIHVzZSB0aGUgaW50ZXJuYWwgY29sbGVjdGlvbiBwcm92aWRlZFxuICAgIGJ5IHRoZSBTY2hlbWF0aWNzIENMSS5cblxuICAgIE9wdGlvbnM6XG4gICAgICAgIC0tZGVidWcgICAgICAgICAgICAgRGVidWcgbW9kZS4gVGhpcyBpcyB0cnVlIGJ5IGRlZmF1bHQgaWYgdGhlIGNvbGxlY3Rpb24gaXMgYSByZWxhdGl2ZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGggKGluIHRoYXQgY2FzZSwgdHVybiBvZmYgd2l0aCAtLWRlYnVnPWZhbHNlKS5cbiAgICAgICAgLS1hbGxvd1ByaXZhdGUgICAgICBBbGxvdyBwcml2YXRlIHNjaGVtYXRpY3MgdG8gYmUgcnVuIGZyb20gdGhlIGNvbW1hbmQgbGluZS4gRGVmYXVsdCB0b1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZhbHNlLlxuICAgICAgICAtLWRyeS1ydW4gICAgICAgICAgIERvIG5vdCBvdXRwdXQgYW55dGhpbmcsIGJ1dCBpbnN0ZWFkIGp1c3Qgc2hvdyB3aGF0IGFjdGlvbnMgd291bGQgYmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJmb3JtZWQuIERlZmF1bHQgdG8gdHJ1ZSBpZiBkZWJ1ZyBpcyBhbHNvIHRydWUuXG4gICAgICAgIC0tZm9yY2UgICAgICAgICAgICAgRm9yY2Ugb3ZlcndyaXRpbmcgZmlsZXMgdGhhdCB3b3VsZCBvdGhlcndpc2UgYmUgYW4gZXJyb3IuXG4gICAgICAgIC0tbGlzdC1zY2hlbWF0aWNzICAgTGlzdCBhbGwgc2NoZW1hdGljcyBmcm9tIHRoZSBjb2xsZWN0aW9uLCBieSBuYW1lLlxuICAgICAgICAtLXZlcmJvc2UgICAgICAgICAgIFNob3cgbW9yZSBpbmZvcm1hdGlvbi5cblxuICAgICAgICAtLWhlbHAgICAgICAgICAgICAgIFNob3cgdGhpcyBtZXNzYWdlLlxuXG4gICAgQW55IGFkZGl0aW9uYWwgb3B0aW9uIGlzIHBhc3NlZCB0byB0aGUgU2NoZW1hdGljcyBkZXBlbmRpbmcgb25cbiAgYCk7XG5cbiAgcHJvY2Vzcy5leGl0KGV4aXRDb2RlKTtcbiAgdGhyb3cgMDsgIC8vIFRoZSBub2RlIHR5cGluZyBzb21ldGltZXMgZG9uJ3QgaGF2ZSBhIG5ldmVyIHR5cGUgZm9yIHByb2Nlc3MuZXhpdCgpLlxufVxuXG5cbi8qKlxuICogUGFyc2UgdGhlIG5hbWUgb2Ygc2NoZW1hdGljIHBhc3NlZCBpbiBhcmd1bWVudCwgYW5kIHJldHVybiBhIHtjb2xsZWN0aW9uLCBzY2hlbWF0aWN9IG5hbWVkXG4gKiB0dXBsZS4gVGhlIHVzZXIgY2FuIHBhc3MgaW4gYGNvbGxlY3Rpb24tbmFtZTpzY2hlbWF0aWMtbmFtZWAsIGFuZCB0aGlzIGZ1bmN0aW9uIHdpbGwgZWl0aGVyXG4gKiByZXR1cm4gYHtjb2xsZWN0aW9uOiAnY29sbGVjdGlvbi1uYW1lJywgc2NoZW1hdGljOiAnc2NoZW1hdGljLW5hbWUnfWAsIG9yIGl0IHdpbGwgZXJyb3Igb3V0XG4gKiBhbmQgc2hvdyB1c2FnZS5cbiAqXG4gKiBJbiB0aGUgY2FzZSB3aGVyZSBhIGNvbGxlY3Rpb24gbmFtZSBpc24ndCBwYXJ0IG9mIHRoZSBhcmd1bWVudCwgdGhlIGRlZmF1bHQgaXMgdG8gdXNlIHRoZVxuICogc2NoZW1hdGljcyBwYWNrYWdlIChAc2NoZW1hdGljcy9zY2hlbWF0aWNzKSBhcyB0aGUgY29sbGVjdGlvbi5cbiAqXG4gKiBUaGlzIGxvZ2ljIGlzIGVudGlyZWx5IHVwIHRvIHRoZSB0b29saW5nLlxuICpcbiAqIEBwYXJhbSBzdHIgVGhlIGFyZ3VtZW50IHRvIHBhcnNlLlxuICogQHJldHVybiB7e2NvbGxlY3Rpb246IHN0cmluZywgc2NoZW1hdGljOiAoc3RyaW5nKX19XG4gKi9cbmZ1bmN0aW9uIHBhcnNlU2NoZW1hdGljTmFtZShzdHI6IHN0cmluZyB8IG51bGwpOiB7IGNvbGxlY3Rpb246IHN0cmluZywgc2NoZW1hdGljOiBzdHJpbmcgfSB7XG4gIGxldCBjb2xsZWN0aW9uID0gJ0BzY2hlbWF0aWNzL3NjaGVtYXRpY3MnO1xuXG4gIGlmICghc3RyIHx8IHN0ciA9PT0gbnVsbCkge1xuICAgIHVzYWdlKDEpO1xuICB9XG5cbiAgbGV0IHNjaGVtYXRpYzogc3RyaW5nID0gc3RyIGFzIHN0cmluZztcbiAgaWYgKHNjaGVtYXRpYy5pbmRleE9mKCc6JykgIT0gLTEpIHtcbiAgICBbY29sbGVjdGlvbiwgc2NoZW1hdGljXSA9IHNjaGVtYXRpYy5zcGxpdCgnOicsIDIpO1xuXG4gICAgaWYgKCFzY2hlbWF0aWMpIHtcbiAgICAgIHVzYWdlKDIpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7IGNvbGxlY3Rpb24sIHNjaGVtYXRpYyB9O1xufVxuXG5cbi8qKiBQYXJzZSB0aGUgY29tbWFuZCBsaW5lLiAqL1xuY29uc3QgYm9vbGVhbkFyZ3MgPSBbXG4gICdhbGxvd1ByaXZhdGUnLFxuICAnZGVidWcnLFxuICAnZHJ5LXJ1bicsXG4gICdmb3JjZScsXG4gICdoZWxwJyxcbiAgJ2xpc3Qtc2NoZW1hdGljcycsXG4gICd2ZXJib3NlJyxcbl07XG5jb25zdCBhcmd2ID0gbWluaW1pc3QocHJvY2Vzcy5hcmd2LnNsaWNlKDIpLCB7XG4gIGJvb2xlYW46IGJvb2xlYW5BcmdzLFxuICBkZWZhdWx0OiB7XG4gICAgJ2RlYnVnJzogbnVsbCxcbiAgICAnZHJ5LXJ1bic6IG51bGwsXG4gIH0sXG4gICctLSc6IHRydWUsXG59KTtcblxuLyoqIENyZWF0ZSB0aGUgRGV2S2l0IExvZ2dlciB1c2VkIHRocm91Z2ggdGhlIENMSS4gKi9cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUNvbnNvbGVMb2dnZXIoYXJndlsndmVyYm9zZSddKTtcblxuaWYgKGFyZ3YuaGVscCkge1xuICB1c2FnZSgpO1xufVxuXG4vKiogR2V0IHRoZSBjb2xsZWN0aW9uIGFuIHNjaGVtYXRpYyBuYW1lIGZyb20gdGhlIGZpcnN0IGFyZ3VtZW50LiAqL1xuY29uc3Qge1xuICBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSxcbiAgc2NoZW1hdGljOiBzY2hlbWF0aWNOYW1lLFxufSA9IHBhcnNlU2NoZW1hdGljTmFtZShhcmd2Ll8uc2hpZnQoKSB8fCBudWxsKTtcbmNvbnN0IGlzTG9jYWxDb2xsZWN0aW9uID0gY29sbGVjdGlvbk5hbWUuc3RhcnRzV2l0aCgnLicpIHx8IGNvbGxlY3Rpb25OYW1lLnN0YXJ0c1dpdGgoJy8nKTtcblxuXG4vKiogSWYgdGhlIHVzZXIgd2FudHMgdG8gbGlzdCBzY2hlbWF0aWNzLCB3ZSBzaW1wbHkgc2hvdyBhbGwgdGhlIHNjaGVtYXRpYyBuYW1lcy4gKi9cbmlmIChhcmd2WydsaXN0LXNjaGVtYXRpY3MnXSkge1xuICAvLyBsb2dnZXIuaW5mbyhlbmdpbmUubGlzdFNjaGVtYXRpY05hbWVzKGNvbGxlY3Rpb24pLmpvaW4oJ1xcbicpKTtcbiAgcHJvY2Vzcy5leGl0KDApO1xuICB0aHJvdyAwOyAgLy8gVHlwZVNjcmlwdCBkb2Vzbid0IGtub3cgdGhhdCBwcm9jZXNzLmV4aXQoKSBuZXZlciByZXR1cm5zLlxufVxuXG5cbi8qKiBHYXRoZXIgdGhlIGFyZ3VtZW50cyBmb3IgbGF0ZXIgdXNlLiAqL1xuY29uc3QgZGVidWc6IGJvb2xlYW4gPSBhcmd2LmRlYnVnID09PSBudWxsID8gaXNMb2NhbENvbGxlY3Rpb24gOiBhcmd2LmRlYnVnO1xuY29uc3QgZHJ5UnVuOiBib29sZWFuID0gYXJndlsnZHJ5LXJ1biddID09PSBudWxsID8gZGVidWcgOiBhcmd2WydkcnktcnVuJ107XG5jb25zdCBmb3JjZSA9IGFyZ3ZbJ2ZvcmNlJ107XG5jb25zdCBhbGxvd1ByaXZhdGUgPSBhcmd2WydhbGxvd1ByaXZhdGUnXTtcblxuLyoqIENyZWF0ZSBhIFZpcnR1YWwgRlMgSG9zdCBzY29wZWQgdG8gd2hlcmUgdGhlIHByb2Nlc3MgaXMgYmVpbmcgcnVuLiAqKi9cbmNvbnN0IGZzSG9zdCA9IG5ldyB2aXJ0dWFsRnMuU2NvcGVkSG9zdChuZXcgTm9kZUpzU3luY0hvc3QoKSwgbm9ybWFsaXplKHByb2Nlc3MuY3dkKCkpKTtcblxuLyoqIENyZWF0ZSB0aGUgd29ya2Zsb3cgdGhhdCB3aWxsIGJlIGV4ZWN1dGVkIHdpdGggdGhpcyBydW4uICovXG5jb25zdCB3b3JrZmxvdyA9IG5ldyBOb2RlV29ya2Zsb3coZnNIb3N0LCB7IGZvcmNlLCBkcnlSdW4gfSk7XG5cbi8vIEluZGljYXRlIHRvIHRoZSB1c2VyIHdoZW4gbm90aGluZyBoYXMgYmVlbiBkb25lLiBUaGlzIGlzIGF1dG9tYXRpY2FsbHkgc2V0IHRvIG9mZiB3aGVuIHRoZXJlJ3Ncbi8vIGEgbmV3IERyeVJ1bkV2ZW50LlxubGV0IG5vdGhpbmdEb25lID0gdHJ1ZTtcblxuLy8gTG9nZ2luZyBxdWV1ZSB0aGF0IHJlY2VpdmVzIGFsbCB0aGUgbWVzc2FnZXMgdG8gc2hvdyB0aGUgdXNlcnMuIFRoaXMgb25seSBnZXQgc2hvd24gd2hlbiBub1xuLy8gZXJyb3JzIGhhcHBlbmVkLlxubGV0IGxvZ2dpbmdRdWV1ZTogc3RyaW5nW10gPSBbXTtcbmxldCBlcnJvciA9IGZhbHNlO1xuXG4vKipcbiAqIExvZ3Mgb3V0IGRyeSBydW4gZXZlbnRzLlxuICpcbiAqIEFsbCBldmVudHMgd2lsbCBhbHdheXMgYmUgZXhlY3V0ZWQgaGVyZSwgaW4gb3JkZXIgb2YgZGlzY292ZXJ5LiBUaGF0IG1lYW5zIHRoYXQgYW4gZXJyb3Igd291bGRcbiAqIGJlIHNob3duIGFsb25nIG90aGVyIGV2ZW50cyB3aGVuIGl0IGhhcHBlbnMuIFNpbmNlIGVycm9ycyBpbiB3b3JrZmxvd3Mgd2lsbCBzdG9wIHRoZSBPYnNlcnZhYmxlXG4gKiBmcm9tIGNvbXBsZXRpbmcgc3VjY2Vzc2Z1bGx5LCB3ZSByZWNvcmQgYW55IGV2ZW50cyBvdGhlciB0aGFuIGVycm9ycywgdGhlbiBvbiBjb21wbGV0aW9uIHdlXG4gKiBzaG93IHRoZW0uXG4gKlxuICogVGhpcyBpcyBhIHNpbXBsZSB3YXkgdG8gb25seSBzaG93IGVycm9ycyB3aGVuIGFuIGVycm9yIG9jY3VyLlxuICovXG53b3JrZmxvdy5yZXBvcnRlci5zdWJzY3JpYmUoKGV2ZW50OiBEcnlSdW5FdmVudCkgPT4ge1xuICBub3RoaW5nRG9uZSA9IGZhbHNlO1xuXG4gIHN3aXRjaCAoZXZlbnQua2luZCkge1xuICAgIGNhc2UgJ2Vycm9yJzpcbiAgICAgIGVycm9yID0gdHJ1ZTtcblxuICAgICAgY29uc3QgZGVzYyA9IGV2ZW50LmRlc2NyaXB0aW9uID09ICdhbHJlYWR5RXhpc3QnID8gJ2FscmVhZHkgZXhpc3RzJyA6ICdkb2VzIG5vdCBleGlzdC4nO1xuICAgICAgbG9nZ2VyLndhcm4oYEVSUk9SISAke2V2ZW50LnBhdGh9ICR7ZGVzY30uYCk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICd1cGRhdGUnOlxuICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2godGFncy5vbmVMaW5lYFxuICAgICAgICAke3Rlcm1pbmFsLndoaXRlKCdVUERBVEUnKX0gJHtldmVudC5wYXRofSAoJHtldmVudC5jb250ZW50Lmxlbmd0aH0gYnl0ZXMpXG4gICAgICBgKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICBsb2dnaW5nUXVldWUucHVzaCh0YWdzLm9uZUxpbmVgXG4gICAgICAgICR7dGVybWluYWwuZ3JlZW4oJ0NSRUFURScpfSAke2V2ZW50LnBhdGh9ICgke2V2ZW50LmNvbnRlbnQubGVuZ3RofSBieXRlcylcbiAgICAgIGApO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke3Rlcm1pbmFsLnllbGxvdygnREVMRVRFJyl9ICR7ZXZlbnQucGF0aH1gKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3JlbmFtZSc6XG4gICAgICBsb2dnaW5nUXVldWUucHVzaChgJHt0ZXJtaW5hbC5ibHVlKCdSRU5BTUUnKX0gJHtldmVudC5wYXRofSA9PiAke2V2ZW50LnRvfWApO1xuICAgICAgYnJlYWs7XG4gIH1cbn0pO1xuXG5cbi8qKlxuICogTGlzdGVuIHRvIGxpZmVjeWNsZSBldmVudHMgb2YgdGhlIHdvcmtmbG93IHRvIGZsdXNoIHRoZSBsb2dzIGJldHdlZW4gZWFjaCBwaGFzZXMuXG4gKi9cbndvcmtmbG93LmxpZmVDeWNsZS5zdWJzY3JpYmUoZXZlbnQgPT4ge1xuICBpZiAoZXZlbnQua2luZCA9PSAnd29ya2Zsb3ctZW5kJyB8fCBldmVudC5raW5kID09ICdwb3N0LXRhc2tzLXN0YXJ0Jykge1xuICAgIGlmICghZXJyb3IpIHtcbiAgICAgIC8vIEZsdXNoIHRoZSBsb2cgcXVldWUgYW5kIGNsZWFuIHRoZSBlcnJvciBzdGF0ZS5cbiAgICAgIGxvZ2dpbmdRdWV1ZS5mb3JFYWNoKGxvZyA9PiBsb2dnZXIuaW5mbyhsb2cpKTtcbiAgICB9XG5cbiAgICBsb2dnaW5nUXVldWUgPSBbXTtcbiAgICBlcnJvciA9IGZhbHNlO1xuICB9XG59KTtcblxuXG4vKipcbiAqIFJlbW92ZSBldmVyeSBvcHRpb25zIGZyb20gYXJndiB0aGF0IHdlIHN1cHBvcnQgaW4gc2NoZW1hdGljcyBpdHNlbGYuXG4gKi9cbmNvbnN0IGFyZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBhcmd2KTtcbmRlbGV0ZSBhcmdzWyctLSddO1xuZm9yIChjb25zdCBrZXkgb2YgYm9vbGVhbkFyZ3MpIHtcbiAgZGVsZXRlIGFyZ3Nba2V5XTtcbn1cblxuLyoqXG4gKiBBZGQgb3B0aW9ucyBmcm9tIGAtLWAgdG8gYXJncy5cbiAqL1xuY29uc3QgYXJndjIgPSBtaW5pbWlzdChhcmd2WyctLSddKTtcbmZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGFyZ3YyKSkge1xuICBhcmdzW2tleV0gPSBhcmd2MltrZXldO1xufVxuXG4vLyBQYXNzIHRoZSByZXN0IG9mIHRoZSBhcmd1bWVudHMgYXMgdGhlIHNtYXJ0IGRlZmF1bHQgXCJhcmd2XCIuIFRoZW4gZGVsZXRlIGl0Llxud29ya2Zsb3cucmVnaXN0cnkuYWRkU21hcnREZWZhdWx0UHJvdmlkZXIoJ2FyZ3YnLCAoc2NoZW1hOiBKc29uT2JqZWN0KSA9PiB7XG4gIGlmICgnaW5kZXgnIGluIHNjaGVtYSkge1xuICAgIHJldHVybiBhcmd2Ll9bTnVtYmVyKHNjaGVtYVsnaW5kZXgnXSldO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhcmd2Ll87XG4gIH1cbn0pO1xuZGVsZXRlIGFyZ3MuXztcblxuXG4vKipcbiAqICBFeGVjdXRlIHRoZSB3b3JrZmxvdywgd2hpY2ggd2lsbCByZXBvcnQgdGhlIGRyeSBydW4gZXZlbnRzLCBydW4gdGhlIHRhc2tzLCBhbmQgY29tcGxldGVcbiAqICBhZnRlciBhbGwgaXMgZG9uZS5cbiAqXG4gKiAgVGhlIE9ic2VydmFibGUgcmV0dXJuZWQgd2lsbCBwcm9wZXJseSBjYW5jZWwgdGhlIHdvcmtmbG93IGlmIHVuc3Vic2NyaWJlZCwgZXJyb3Igb3V0IGlmIEFOWVxuICogIHN0ZXAgb2YgdGhlIHdvcmtmbG93IGZhaWxlZCAoc2luayBvciB0YXNrKSwgd2l0aCBkZXRhaWxzIGluY2x1ZGVkLCBhbmQgd2lsbCBvbmx5IGNvbXBsZXRlXG4gKiAgd2hlbiBldmVyeXRoaW5nIGlzIGRvbmUuXG4gKi9cbndvcmtmbG93LmV4ZWN1dGUoe1xuICBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSxcbiAgc2NoZW1hdGljOiBzY2hlbWF0aWNOYW1lLFxuICBvcHRpb25zOiBhcmdzLFxuICBhbGxvd1ByaXZhdGU6IGFsbG93UHJpdmF0ZSxcbiAgZGVidWc6IGRlYnVnLFxuICBsb2dnZXI6IGxvZ2dlcixcbn0pXG4uc3Vic2NyaWJlKHtcbiAgZXJyb3IoZXJyOiBFcnJvcikge1xuICAgIC8vIEluIGNhc2UgdGhlIHdvcmtmbG93IHdhcyBub3Qgc3VjY2Vzc2Z1bCwgc2hvdyBhbiBhcHByb3ByaWF0ZSBlcnJvciBtZXNzYWdlLlxuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBVbnN1Y2Nlc3NmdWxXb3JrZmxvd0V4ZWN1dGlvbikge1xuICAgICAgLy8gXCJTZWUgYWJvdmVcIiBiZWNhdXNlIHdlIGFscmVhZHkgcHJpbnRlZCB0aGUgZXJyb3IuXG4gICAgICBsb2dnZXIuZmF0YWwoJ1RoZSBTY2hlbWF0aWMgd29ya2Zsb3cgZmFpbGVkLiBTZWUgYWJvdmUuJyk7XG4gICAgfSBlbHNlIGlmIChkZWJ1Zykge1xuICAgICAgbG9nZ2VyLmZhdGFsKCdBbiBlcnJvciBvY2N1cmVkOlxcbicgKyBlcnIuc3RhY2spO1xuICAgIH0gZWxzZSB7XG4gICAgICBsb2dnZXIuZmF0YWwoZXJyLm1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgfSxcbiAgY29tcGxldGUoKSB7XG4gICAgaWYgKG5vdGhpbmdEb25lKSB7XG4gICAgICBsb2dnZXIuaW5mbygnTm90aGluZyB0byBiZSBkb25lLicpO1xuICAgIH1cbiAgfSxcbn0pO1xuIl19