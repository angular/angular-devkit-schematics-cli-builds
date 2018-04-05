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
const booleanArgs = ['debug', 'dry-run', 'force', 'help', 'list-schematics', 'verbose'];
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
/** Create a Virtual FS Host scoped to where the process is being run. **/
const fsHost = new core_1.virtualFs.ScopedHost(new node_1.NodeJsSyncHost(), core_1.normalize(process.cwd()));
/** Create the workflow that will be executed with this run. */
const workflow = new tools_1.NodeWorkflow(fsHost, { force, dryRun });
// Indicate to the user when nothing has been done. This is automatically set to off when there's
// a new DryRunEvent.
let nothingDone = true;
// Logging queue that receives all the messages to show the users. This only get shown when no
// errors happened.
const loggingQueue = [];
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIuLyIsInNvdXJjZXMiOlsicGFja2FnZXMvYW5ndWxhcl9kZXZraXQvc2NoZW1hdGljc19jbGkvYmluL3NjaGVtYXRpY3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBU0EsNkJBQTJCO0FBQzNCLGdDQUFnQztBQUNoQyx5REFBeUQ7QUFDekQsK0NBTThCO0FBQzlCLG9EQUFnRjtBQUNoRiwyREFBd0Y7QUFDeEYsNERBQWdFO0FBQ2hFLHFDQUFxQztBQUdyQzs7R0FFRztBQUNILGVBQWUsUUFBUSxHQUFHLENBQUM7SUFDekIsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFJLENBQUMsV0FBVyxDQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQjNCLENBQUMsQ0FBQztJQUVILE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDdkIsTUFBTSxDQUFDLENBQUMsQ0FBRSx3RUFBd0U7QUFDcEYsQ0FBQztBQUdEOzs7Ozs7Ozs7Ozs7O0dBYUc7QUFDSCw0QkFBNEIsR0FBa0I7SUFDNUMsSUFBSSxVQUFVLEdBQUcsd0JBQXdCLENBQUM7SUFFMUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksR0FBRyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUM7UUFDekIsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ1gsQ0FBQztJQUVELElBQUksU0FBUyxHQUFXLEdBQWEsQ0FBQztJQUN0QyxFQUFFLENBQUMsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNqQyxDQUFDLFVBQVUsRUFBRSxTQUFTLENBQUMsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUVsRCxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7WUFDZixLQUFLLENBQUMsQ0FBQyxDQUFDLENB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bnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCAnc3ltYm9sLW9ic2VydmFibGUnO1xuLy8gc3ltYm9sIHBvbHlmaWxsIG11c3QgZ28gZmlyc3Rcbi8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpvcmRlcmVkLWltcG9ydHMgaW1wb3J0LWdyb3Vwc1xuaW1wb3J0IHtcbiAgSnNvbk9iamVjdCxcbiAgbm9ybWFsaXplLFxuICB0YWdzLFxuICB0ZXJtaW5hbCxcbiAgdmlydHVhbEZzLFxufSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZSc7XG5pbXBvcnQgeyBOb2RlSnNTeW5jSG9zdCwgY3JlYXRlQ29uc29sZUxvZ2dlciB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlL25vZGUnO1xuaW1wb3J0IHsgRHJ5UnVuRXZlbnQsIFVuc3VjY2Vzc2Z1bFdvcmtmbG93RXhlY3V0aW9uIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MnO1xuaW1wb3J0IHsgTm9kZVdvcmtmbG93IH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MvdG9vbHMnO1xuaW1wb3J0ICogYXMgbWluaW1pc3QgZnJvbSAnbWluaW1pc3QnO1xuXG5cbi8qKlxuICogU2hvdyB1c2FnZSBvZiB0aGUgQ0xJIHRvb2wsIGFuZCBleGl0IHRoZSBwcm9jZXNzLlxuICovXG5mdW5jdGlvbiB1c2FnZShleGl0Q29kZSA9IDApOiBuZXZlciB7XG4gIGxvZ2dlci5pbmZvKHRhZ3Muc3RyaXBJbmRlbnRgXG4gICAgc2NoZW1hdGljcyBbQ29sbGVjdGlvbk5hbWU6XVNjaGVtYXRpY05hbWUgW29wdGlvbnMsIC4uLl1cblxuICAgIEJ5IGRlZmF1bHQsIGlmIHRoZSBjb2xsZWN0aW9uIG5hbWUgaXMgbm90IHNwZWNpZmllZCwgdXNlIHRoZSBpbnRlcm5hbCBjb2xsZWN0aW9uIHByb3ZpZGVkXG4gICAgYnkgdGhlIFNjaGVtYXRpY3MgQ0xJLlxuXG4gICAgT3B0aW9uczpcbiAgICAgICAgLS1kZWJ1ZyAgICAgICAgICAgICBEZWJ1ZyBtb2RlLiBUaGlzIGlzIHRydWUgYnkgZGVmYXVsdCBpZiB0aGUgY29sbGVjdGlvbiBpcyBhIHJlbGF0aXZlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aCAoaW4gdGhhdCBjYXNlLCB0dXJuIG9mZiB3aXRoIC0tZGVidWc9ZmFsc2UpLlxuICAgICAgICAtLWRyeS1ydW4gICAgICAgICAgIERvIG5vdCBvdXRwdXQgYW55dGhpbmcsIGJ1dCBpbnN0ZWFkIGp1c3Qgc2hvdyB3aGF0IGFjdGlvbnMgd291bGQgYmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJmb3JtZWQuIERlZmF1bHQgdG8gdHJ1ZSBpZiBkZWJ1ZyBpcyBhbHNvIHRydWUuXG4gICAgICAgIC0tZm9yY2UgICAgICAgICAgICAgRm9yY2Ugb3ZlcndyaXRpbmcgZmlsZXMgdGhhdCB3b3VsZCBvdGhlcndpc2UgYmUgYW4gZXJyb3IuXG4gICAgICAgIC0tbGlzdC1zY2hlbWF0aWNzICAgTGlzdCBhbGwgc2NoZW1hdGljcyBmcm9tIHRoZSBjb2xsZWN0aW9uLCBieSBuYW1lLlxuICAgICAgICAtLXZlcmJvc2UgICAgICAgICAgIFNob3cgbW9yZSBpbmZvcm1hdGlvbi5cblxuICAgICAgICAtLWhlbHAgICAgICAgICAgICAgIFNob3cgdGhpcyBtZXNzYWdlLlxuXG4gICAgQW55IGFkZGl0aW9uYWwgb3B0aW9uIGlzIHBhc3NlZCB0byB0aGUgU2NoZW1hdGljcyBkZXBlbmRpbmcgb25cbiAgYCk7XG5cbiAgcHJvY2Vzcy5leGl0KGV4aXRDb2RlKTtcbiAgdGhyb3cgMDsgIC8vIFRoZSBub2RlIHR5cGluZyBzb21ldGltZXMgZG9uJ3QgaGF2ZSBhIG5ldmVyIHR5cGUgZm9yIHByb2Nlc3MuZXhpdCgpLlxufVxuXG5cbi8qKlxuICogUGFyc2UgdGhlIG5hbWUgb2Ygc2NoZW1hdGljIHBhc3NlZCBpbiBhcmd1bWVudCwgYW5kIHJldHVybiBhIHtjb2xsZWN0aW9uLCBzY2hlbWF0aWN9IG5hbWVkXG4gKiB0dXBsZS4gVGhlIHVzZXIgY2FuIHBhc3MgaW4gYGNvbGxlY3Rpb24tbmFtZTpzY2hlbWF0aWMtbmFtZWAsIGFuZCB0aGlzIGZ1bmN0aW9uIHdpbGwgZWl0aGVyXG4gKiByZXR1cm4gYHtjb2xsZWN0aW9uOiAnY29sbGVjdGlvbi1uYW1lJywgc2NoZW1hdGljOiAnc2NoZW1hdGljLW5hbWUnfWAsIG9yIGl0IHdpbGwgZXJyb3Igb3V0XG4gKiBhbmQgc2hvdyB1c2FnZS5cbiAqXG4gKiBJbiB0aGUgY2FzZSB3aGVyZSBhIGNvbGxlY3Rpb24gbmFtZSBpc24ndCBwYXJ0IG9mIHRoZSBhcmd1bWVudCwgdGhlIGRlZmF1bHQgaXMgdG8gdXNlIHRoZVxuICogc2NoZW1hdGljcyBwYWNrYWdlIChAc2NoZW1hdGljcy9zY2hlbWF0aWNzKSBhcyB0aGUgY29sbGVjdGlvbi5cbiAqXG4gKiBUaGlzIGxvZ2ljIGlzIGVudGlyZWx5IHVwIHRvIHRoZSB0b29saW5nLlxuICpcbiAqIEBwYXJhbSBzdHIgVGhlIGFyZ3VtZW50IHRvIHBhcnNlLlxuICogQHJldHVybiB7e2NvbGxlY3Rpb246IHN0cmluZywgc2NoZW1hdGljOiAoc3RyaW5nKX19XG4gKi9cbmZ1bmN0aW9uIHBhcnNlU2NoZW1hdGljTmFtZShzdHI6IHN0cmluZyB8IG51bGwpOiB7IGNvbGxlY3Rpb246IHN0cmluZywgc2NoZW1hdGljOiBzdHJpbmcgfSB7XG4gIGxldCBjb2xsZWN0aW9uID0gJ0BzY2hlbWF0aWNzL3NjaGVtYXRpY3MnO1xuXG4gIGlmICghc3RyIHx8IHN0ciA9PT0gbnVsbCkge1xuICAgIHVzYWdlKDEpO1xuICB9XG5cbiAgbGV0IHNjaGVtYXRpYzogc3RyaW5nID0gc3RyIGFzIHN0cmluZztcbiAgaWYgKHNjaGVtYXRpYy5pbmRleE9mKCc6JykgIT0gLTEpIHtcbiAgICBbY29sbGVjdGlvbiwgc2NoZW1hdGljXSA9IHNjaGVtYXRpYy5zcGxpdCgnOicsIDIpO1xuXG4gICAgaWYgKCFzY2hlbWF0aWMpIHtcbiAgICAgIHVzYWdlKDIpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7IGNvbGxlY3Rpb24sIHNjaGVtYXRpYyB9O1xufVxuXG5cbi8qKiBQYXJzZSB0aGUgY29tbWFuZCBsaW5lLiAqL1xuY29uc3QgYm9vbGVhbkFyZ3MgPSBbICdkZWJ1ZycsICdkcnktcnVuJywgJ2ZvcmNlJywgJ2hlbHAnLCAnbGlzdC1zY2hlbWF0aWNzJywgJ3ZlcmJvc2UnIF07XG5jb25zdCBhcmd2ID0gbWluaW1pc3QocHJvY2Vzcy5hcmd2LnNsaWNlKDIpLCB7XG4gIGJvb2xlYW46IGJvb2xlYW5BcmdzLFxuICBkZWZhdWx0OiB7XG4gICAgJ2RlYnVnJzogbnVsbCxcbiAgICAnZHJ5LXJ1bic6IG51bGwsXG4gIH0sXG4gICctLSc6IHRydWUsXG59KTtcblxuLyoqIENyZWF0ZSB0aGUgRGV2S2l0IExvZ2dlciB1c2VkIHRocm91Z2ggdGhlIENMSS4gKi9cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUNvbnNvbGVMb2dnZXIoYXJndlsndmVyYm9zZSddKTtcblxuaWYgKGFyZ3YuaGVscCkge1xuICB1c2FnZSgpO1xufVxuXG4vKiogR2V0IHRoZSBjb2xsZWN0aW9uIGFuIHNjaGVtYXRpYyBuYW1lIGZyb20gdGhlIGZpcnN0IGFyZ3VtZW50LiAqL1xuY29uc3Qge1xuICBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSxcbiAgc2NoZW1hdGljOiBzY2hlbWF0aWNOYW1lLFxufSA9IHBhcnNlU2NoZW1hdGljTmFtZShhcmd2Ll8uc2hpZnQoKSB8fCBudWxsKTtcbmNvbnN0IGlzTG9jYWxDb2xsZWN0aW9uID0gY29sbGVjdGlvbk5hbWUuc3RhcnRzV2l0aCgnLicpIHx8IGNvbGxlY3Rpb25OYW1lLnN0YXJ0c1dpdGgoJy8nKTtcblxuXG4vKiogSWYgdGhlIHVzZXIgd2FudHMgdG8gbGlzdCBzY2hlbWF0aWNzLCB3ZSBzaW1wbHkgc2hvdyBhbGwgdGhlIHNjaGVtYXRpYyBuYW1lcy4gKi9cbmlmIChhcmd2WydsaXN0LXNjaGVtYXRpY3MnXSkge1xuICAvLyBsb2dnZXIuaW5mbyhlbmdpbmUubGlzdFNjaGVtYXRpY05hbWVzKGNvbGxlY3Rpb24pLmpvaW4oJ1xcbicpKTtcbiAgcHJvY2Vzcy5leGl0KDApO1xuICB0aHJvdyAwOyAgLy8gVHlwZVNjcmlwdCBkb2Vzbid0IGtub3cgdGhhdCBwcm9jZXNzLmV4aXQoKSBuZXZlciByZXR1cm5zLlxufVxuXG5cbi8qKiBHYXRoZXIgdGhlIGFyZ3VtZW50cyBmb3IgbGF0ZXIgdXNlLiAqL1xuY29uc3QgZGVidWc6IGJvb2xlYW4gPSBhcmd2LmRlYnVnID09PSBudWxsID8gaXNMb2NhbENvbGxlY3Rpb24gOiBhcmd2LmRlYnVnO1xuY29uc3QgZHJ5UnVuOiBib29sZWFuID0gYXJndlsnZHJ5LXJ1biddID09PSBudWxsID8gZGVidWcgOiBhcmd2WydkcnktcnVuJ107XG5jb25zdCBmb3JjZSA9IGFyZ3ZbJ2ZvcmNlJ107XG5cbi8qKiBDcmVhdGUgYSBWaXJ0dWFsIEZTIEhvc3Qgc2NvcGVkIHRvIHdoZXJlIHRoZSBwcm9jZXNzIGlzIGJlaW5nIHJ1bi4gKiovXG5jb25zdCBmc0hvc3QgPSBuZXcgdmlydHVhbEZzLlNjb3BlZEhvc3QobmV3IE5vZGVKc1N5bmNIb3N0KCksIG5vcm1hbGl6ZShwcm9jZXNzLmN3ZCgpKSk7XG5cbi8qKiBDcmVhdGUgdGhlIHdvcmtmbG93IHRoYXQgd2lsbCBiZSBleGVjdXRlZCB3aXRoIHRoaXMgcnVuLiAqL1xuY29uc3Qgd29ya2Zsb3cgPSBuZXcgTm9kZVdvcmtmbG93KGZzSG9zdCwgeyBmb3JjZSwgZHJ5UnVuIH0pO1xuXG4vLyBJbmRpY2F0ZSB0byB0aGUgdXNlciB3aGVuIG5vdGhpbmcgaGFzIGJlZW4gZG9uZS4gVGhpcyBpcyBhdXRvbWF0aWNhbGx5IHNldCB0byBvZmYgd2hlbiB0aGVyZSdzXG4vLyBhIG5ldyBEcnlSdW5FdmVudC5cbmxldCBub3RoaW5nRG9uZSA9IHRydWU7XG5cbi8vIExvZ2dpbmcgcXVldWUgdGhhdCByZWNlaXZlcyBhbGwgdGhlIG1lc3NhZ2VzIHRvIHNob3cgdGhlIHVzZXJzLiBUaGlzIG9ubHkgZ2V0IHNob3duIHdoZW4gbm9cbi8vIGVycm9ycyBoYXBwZW5lZC5cbmNvbnN0IGxvZ2dpbmdRdWV1ZTogc3RyaW5nW10gPSBbXTtcbmxldCBlcnJvciA9IGZhbHNlO1xuXG4vKipcbiAqIExvZ3Mgb3V0IGRyeSBydW4gZXZlbnRzLlxuICpcbiAqIEFsbCBldmVudHMgd2lsbCBhbHdheXMgYmUgZXhlY3V0ZWQgaGVyZSwgaW4gb3JkZXIgb2YgZGlzY292ZXJ5LiBUaGF0IG1lYW5zIHRoYXQgYW4gZXJyb3Igd291bGRcbiAqIGJlIHNob3duIGFsb25nIG90aGVyIGV2ZW50cyB3aGVuIGl0IGhhcHBlbnMuIFNpbmNlIGVycm9ycyBpbiB3b3JrZmxvd3Mgd2lsbCBzdG9wIHRoZSBPYnNlcnZhYmxlXG4gKiBmcm9tIGNvbXBsZXRpbmcgc3VjY2Vzc2Z1bGx5LCB3ZSByZWNvcmQgYW55IGV2ZW50cyBvdGhlciB0aGFuIGVycm9ycywgdGhlbiBvbiBjb21wbGV0aW9uIHdlXG4gKiBzaG93IHRoZW0uXG4gKlxuICogVGhpcyBpcyBhIHNpbXBsZSB3YXkgdG8gb25seSBzaG93IGVycm9ycyB3aGVuIGFuIGVycm9yIG9jY3VyLlxuICovXG53b3JrZmxvdy5yZXBvcnRlci5zdWJzY3JpYmUoKGV2ZW50OiBEcnlSdW5FdmVudCkgPT4ge1xuICBub3RoaW5nRG9uZSA9IGZhbHNlO1xuXG4gIHN3aXRjaCAoZXZlbnQua2luZCkge1xuICAgIGNhc2UgJ2Vycm9yJzpcbiAgICAgIGVycm9yID0gdHJ1ZTtcblxuICAgICAgY29uc3QgZGVzYyA9IGV2ZW50LmRlc2NyaXB0aW9uID09ICdhbHJlYWR5RXhpc3QnID8gJ2FscmVhZHkgZXhpc3RzJyA6ICdkb2VzIG5vdCBleGlzdC4nO1xuICAgICAgbG9nZ2VyLndhcm4oYEVSUk9SISAke2V2ZW50LnBhdGh9ICR7ZGVzY30uYCk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICd1cGRhdGUnOlxuICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2godGFncy5vbmVMaW5lYFxuICAgICAgICAke3Rlcm1pbmFsLndoaXRlKCdVUERBVEUnKX0gJHtldmVudC5wYXRofSAoJHtldmVudC5jb250ZW50Lmxlbmd0aH0gYnl0ZXMpXG4gICAgICBgKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICBsb2dnaW5nUXVldWUucHVzaCh0YWdzLm9uZUxpbmVgXG4gICAgICAgICR7dGVybWluYWwuZ3JlZW4oJ0NSRUFURScpfSAke2V2ZW50LnBhdGh9ICgke2V2ZW50LmNvbnRlbnQubGVuZ3RofSBieXRlcylcbiAgICAgIGApO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke3Rlcm1pbmFsLnllbGxvdygnREVMRVRFJyl9ICR7ZXZlbnQucGF0aH1gKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3JlbmFtZSc6XG4gICAgICBsb2dnaW5nUXVldWUucHVzaChgJHt0ZXJtaW5hbC5ibHVlKCdSRU5BTUUnKX0gJHtldmVudC5wYXRofSA9PiAke2V2ZW50LnRvfWApO1xuICAgICAgYnJlYWs7XG4gIH1cbn0pO1xuXG5cbi8qKlxuICogTGlzdGVuIHRvIGxpZmVjeWNsZSBldmVudHMgb2YgdGhlIHdvcmtmbG93IHRvIGZsdXNoIHRoZSBsb2dzIGJldHdlZW4gZWFjaCBwaGFzZXMuXG4gKi9cbndvcmtmbG93LmxpZmVDeWNsZS5zdWJzY3JpYmUoZXZlbnQgPT4ge1xuICBpZiAoZXZlbnQua2luZCA9PSAnd29ya2Zsb3ctZW5kJyB8fCBldmVudC5raW5kID09ICdwb3N0LXRhc2tzLXN0YXJ0Jykge1xuICAgIGlmICghZXJyb3IpIHtcbiAgICAgIC8vIEZsdXNoIHRoZSBsb2cgcXVldWUgYW5kIGNsZWFuIHRoZSBlcnJvciBzdGF0ZS5cbiAgICAgIGxvZ2dpbmdRdWV1ZS5mb3JFYWNoKGxvZyA9PiBsb2dnZXIuaW5mbyhsb2cpKTtcbiAgICB9XG5cbiAgICBlcnJvciA9IGZhbHNlO1xuICB9XG59KTtcblxuXG4vKipcbiAqIFJlbW92ZSBldmVyeSBvcHRpb25zIGZyb20gYXJndiB0aGF0IHdlIHN1cHBvcnQgaW4gc2NoZW1hdGljcyBpdHNlbGYuXG4gKi9cbmNvbnN0IGFyZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBhcmd2KTtcbmRlbGV0ZSBhcmdzWyctLSddO1xuZm9yIChjb25zdCBrZXkgb2YgYm9vbGVhbkFyZ3MpIHtcbiAgZGVsZXRlIGFyZ3Nba2V5XTtcbn1cblxuLyoqXG4gKiBBZGQgb3B0aW9ucyBmcm9tIGAtLWAgdG8gYXJncy5cbiAqL1xuY29uc3QgYXJndjIgPSBtaW5pbWlzdChhcmd2WyctLSddKTtcbmZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGFyZ3YyKSkge1xuICBhcmdzW2tleV0gPSBhcmd2MltrZXldO1xufVxuXG4vLyBQYXNzIHRoZSByZXN0IG9mIHRoZSBhcmd1bWVudHMgYXMgdGhlIHNtYXJ0IGRlZmF1bHQgXCJhcmd2XCIuIFRoZW4gZGVsZXRlIGl0Llxud29ya2Zsb3cucmVnaXN0cnkuYWRkU21hcnREZWZhdWx0UHJvdmlkZXIoJ2FyZ3YnLCAoc2NoZW1hOiBKc29uT2JqZWN0KSA9PiB7XG4gIGlmICgnaW5kZXgnIGluIHNjaGVtYSkge1xuICAgIHJldHVybiBhcmd2Ll9bTnVtYmVyKHNjaGVtYVsnaW5kZXgnXSldO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhcmd2Ll87XG4gIH1cbn0pO1xuZGVsZXRlIGFyZ3MuXztcblxuXG4vKipcbiAqICBFeGVjdXRlIHRoZSB3b3JrZmxvdywgd2hpY2ggd2lsbCByZXBvcnQgdGhlIGRyeSBydW4gZXZlbnRzLCBydW4gdGhlIHRhc2tzLCBhbmQgY29tcGxldGVcbiAqICBhZnRlciBhbGwgaXMgZG9uZS5cbiAqXG4gKiAgVGhlIE9ic2VydmFibGUgcmV0dXJuZWQgd2lsbCBwcm9wZXJseSBjYW5jZWwgdGhlIHdvcmtmbG93IGlmIHVuc3Vic2NyaWJlZCwgZXJyb3Igb3V0IGlmIEFOWVxuICogIHN0ZXAgb2YgdGhlIHdvcmtmbG93IGZhaWxlZCAoc2luayBvciB0YXNrKSwgd2l0aCBkZXRhaWxzIGluY2x1ZGVkLCBhbmQgd2lsbCBvbmx5IGNvbXBsZXRlXG4gKiAgd2hlbiBldmVyeXRoaW5nIGlzIGRvbmUuXG4gKi9cbndvcmtmbG93LmV4ZWN1dGUoe1xuICBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSxcbiAgc2NoZW1hdGljOiBzY2hlbWF0aWNOYW1lLFxuICBvcHRpb25zOiBhcmdzLFxuICBkZWJ1ZzogZGVidWcsXG4gIGxvZ2dlcjogbG9nZ2VyLFxufSlcbi5zdWJzY3JpYmUoe1xuICBlcnJvcihlcnI6IEVycm9yKSB7XG4gICAgLy8gSW4gY2FzZSB0aGUgd29ya2Zsb3cgd2FzIG5vdCBzdWNjZXNzZnVsLCBzaG93IGFuIGFwcHJvcHJpYXRlIGVycm9yIG1lc3NhZ2UuXG4gICAgaWYgKGVyciBpbnN0YW5jZW9mIFVuc3VjY2Vzc2Z1bFdvcmtmbG93RXhlY3V0aW9uKSB7XG4gICAgICAvLyBcIlNlZSBhYm92ZVwiIGJlY2F1c2Ugd2UgYWxyZWFkeSBwcmludGVkIHRoZSBlcnJvci5cbiAgICAgIGxvZ2dlci5mYXRhbCgnVGhlIFNjaGVtYXRpYyB3b3JrZmxvdyBmYWlsZWQuIFNlZSBhYm92ZS4nKTtcbiAgICB9IGVsc2UgaWYgKGRlYnVnKSB7XG4gICAgICBsb2dnZXIuZmF0YWwoJ0FuIGVycm9yIG9jY3VyZWQ6XFxuJyArIGVyci5zdGFjayk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvZ2dlci5mYXRhbChlcnIubWVzc2FnZSk7XG4gICAgfVxuXG4gICAgcHJvY2Vzcy5leGl0KDEpO1xuICB9LFxuICBjb21wbGV0ZSgpIHtcbiAgICBpZiAobm90aGluZ0RvbmUpIHtcbiAgICAgIGxvZ2dlci5pbmZvKCdOb3RoaW5nIHRvIGJlIGRvbmUuJyk7XG4gICAgfVxuICB9LFxufSk7XG4iXX0=