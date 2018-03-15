#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
        // Output the logging queue, no error happened.
        loggingQueue.forEach(log => logger.info(log));
        if (nothingDone) {
            logger.info('Nothing to be done.');
        }
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIuLyIsInNvdXJjZXMiOlsicGFja2FnZXMvYW5ndWxhcl9kZXZraXQvc2NoZW1hdGljc19jbGkvYmluL3NjaGVtYXRpY3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBUUEsK0NBTThCO0FBQzlCLG9EQUFnRjtBQUNoRiwyREFBd0Y7QUFDeEYsNERBQWdFO0FBQ2hFLHFDQUFxQztBQUdyQzs7R0FFRztBQUNILGVBQWUsUUFBUSxHQUFHLENBQUM7SUFDekIsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFJLENBQUMsV0FBVyxDQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQjNCLENBQUMsQ0FBQztJQUVILE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDdkIsTUFBTSxDQUFDLENBQUMsQ0FBRSx3RUFBd0U7QUFDcEYsQ0FBQztBQUdEOzs7Ozs7Ozs7Ozs7O0dBYUc7QUFDSCw0QkFBNEIsR0FBa0I7SUFDNUMsSUFBSSxVQUFVLEdBQUcsd0JBQXdCLENBQUM7SUFFMUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksR0FBRyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUM7UUFDekIsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ1gsQ0FBQztJQUVELElBQUksU0FBUyxHQUFXLEdBQWEsQ0FBQztJQUN0QyxFQUFFLENBQUMsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNqQyxDQUFDLFVBQVUsRUFBRSxTQUFTLENBQUMsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUVsRCxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7WUFDZixLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDWCxDQUFDO0lBQ0gsQ0FBQztJQUVELE1BQU0sQ0FBQyxF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Q0FBQyxJQUFJLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQztZQUM3QyxLQUFLLENBQUM7UUFDUixLQUFLLFFBQVE7WUFDWCxZQUFZLENBQUMsSUFBSSxDQUFDLFdBQUksQ0FBQyxPQUFPLENBQUE7VUFDMUIsZUFBUSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTTtPQUNsRSxDQUFDLENBQUM7WUFDSCxLQUFLLENBQUM7UUFDUixLQUFLLFFBQVE7WUFDWCxZQUFZLENBQUMsSUFBSSxDQUFDLFdBQUksQ0FBQyxPQUFPLENBQUE7VUFDMUIsZUFBUSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTTtPQUNsRSxDQUFDLENBQUM7WUFDSCxLQUFLLENBQUM7UUFDUixLQUFLLFFBQVE7WUFDWCxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsZUFBUSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUNoRSxLQUFLLENBQUM7UUFDUixLQUFLLFFBQVE7WUFDWCxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsZUFBUSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxPQUFPLEtBQUssQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQzdFLEtBQUssQ0FBQztJQUNWLENBQUM7QUFDSCxDQUFDLENBQUMsQ0FBQztBQUdIOztHQUVHO0FBQ0gsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQUM7QUFDckMsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDbEIsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLElBQUksV0FBVyxDQUFDLENBQUMsQ0FBQztJQUM5QixPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUNuQixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxNQUFNLEtBQUssR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7QUFDbkMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDckMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUN6QixDQUFDO0FBRUQsOEVBQThFO0FBQzlFLFFBQVEsQ0FBQyxRQUFRLENBQUMsdUJBQXVCLENBQUMsTUFBTSxFQUFFLENBQUMsTUFBa0IsRUFBRSxFQUFFO0lBQ3ZFLEVBQUUsQ0FBQyxDQUFDLE9BQU8sSUFBSSxNQUFNLENBQUMsQ0FBQyxDQUFDO1FBQ3RCLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3pDLENBQUM7SUFBQyxJQUFJLENBQUMsQ0FBQztRQUNOLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBQ2hCLENBQUM7QUFDSCxDQUFDLENBQUMsQ0FBQztBQUNILE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQztBQUdkOzs7Ozs7O0dBT0c7QUFDSCxRQUFRLENBQUMsT0FBTyxDQUFDO0lBQ2YsVUFBVSxFQUFFLGNBQWM7SUFDMUIsU0FBUyxFQUFFLGFBQWE7SUFDeEIsT0FBTyxFQUFFLElBQUk7SUFDYixLQUFLLEVBQUUsS0FBSztJQUNaLE1BQU0sRUFBRSxNQUFNO0NBQ2YsQ0FBQztLQUNELFNBQVMsQ0FBQztJQUNULEtBQUssQ0FBQyxHQUFVO1FBQ2QsOEVBQThFO1FBQzlFLEVBQUUsQ0FBQyxDQUFDLEdBQUcsWUFBWSwwQ0FBNkIsQ0FBQyxDQUFDLENBQUM7WUFDakQsb0RBQW9EO1lBQ3BELE1BQU0sQ0FBQyxLQUFLLENBQUMsMkNBQTJDLENBQUMsQ0FBQztRQUM1RCxDQUFDO1FBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7WUFDakIsTUFBTSxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDbEQsQ0FBQztRQUFDLElBQUksQ0FBQyxDQUFDO1lBQ04sTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDNUIsQ0FBQztRQUVELE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDbEIsQ0FBQztJQUNELFFBQVE7UUFDTiwrQ0FBK0M7UUFDL0MsWUFBWSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUU5QyxFQUFFLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1lBQ2hCLE1BQU0sQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQztRQUNyQyxDQUFDO0lBQ0gsQ0FBQztDQUNGLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cbmltcG9ydCB7XG4gIEpzb25PYmplY3QsXG4gIG5vcm1hbGl6ZSxcbiAgdGFncyxcbiAgdGVybWluYWwsXG4gIHZpcnR1YWxGcyxcbn0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgTm9kZUpzU3luY0hvc3QsIGNyZWF0ZUNvbnNvbGVMb2dnZXIgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZS9ub2RlJztcbmltcG9ydCB7IERyeVJ1bkV2ZW50LCBVbnN1Y2Nlc3NmdWxXb3JrZmxvd0V4ZWN1dGlvbiB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzJztcbmltcG9ydCB7IE5vZGVXb3JrZmxvdyB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzL3Rvb2xzJztcbmltcG9ydCAqIGFzIG1pbmltaXN0IGZyb20gJ21pbmltaXN0JztcblxuXG4vKipcbiAqIFNob3cgdXNhZ2Ugb2YgdGhlIENMSSB0b29sLCBhbmQgZXhpdCB0aGUgcHJvY2Vzcy5cbiAqL1xuZnVuY3Rpb24gdXNhZ2UoZXhpdENvZGUgPSAwKTogbmV2ZXIge1xuICBsb2dnZXIuaW5mbyh0YWdzLnN0cmlwSW5kZW50YFxuICAgIHNjaGVtYXRpY3MgW0NvbGxlY3Rpb25OYW1lOl1TY2hlbWF0aWNOYW1lIFtvcHRpb25zLCAuLi5dXG5cbiAgICBCeSBkZWZhdWx0LCBpZiB0aGUgY29sbGVjdGlvbiBuYW1lIGlzIG5vdCBzcGVjaWZpZWQsIHVzZSB0aGUgaW50ZXJuYWwgY29sbGVjdGlvbiBwcm92aWRlZFxuICAgIGJ5IHRoZSBTY2hlbWF0aWNzIENMSS5cblxuICAgIE9wdGlvbnM6XG4gICAgICAgIC0tZGVidWcgICAgICAgICAgICAgRGVidWcgbW9kZS4gVGhpcyBpcyB0cnVlIGJ5IGRlZmF1bHQgaWYgdGhlIGNvbGxlY3Rpb24gaXMgYSByZWxhdGl2ZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGggKGluIHRoYXQgY2FzZSwgdHVybiBvZmYgd2l0aCAtLWRlYnVnPWZhbHNlKS5cbiAgICAgICAgLS1kcnktcnVuICAgICAgICAgICBEbyBub3Qgb3V0cHV0IGFueXRoaW5nLCBidXQgaW5zdGVhZCBqdXN0IHNob3cgd2hhdCBhY3Rpb25zIHdvdWxkIGJlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGVyZm9ybWVkLiBEZWZhdWx0IHRvIHRydWUgaWYgZGVidWcgaXMgYWxzbyB0cnVlLlxuICAgICAgICAtLWZvcmNlICAgICAgICAgICAgIEZvcmNlIG92ZXJ3cml0aW5nIGZpbGVzIHRoYXQgd291bGQgb3RoZXJ3aXNlIGJlIGFuIGVycm9yLlxuICAgICAgICAtLWxpc3Qtc2NoZW1hdGljcyAgIExpc3QgYWxsIHNjaGVtYXRpY3MgZnJvbSB0aGUgY29sbGVjdGlvbiwgYnkgbmFtZS5cbiAgICAgICAgLS12ZXJib3NlICAgICAgICAgICBTaG93IG1vcmUgaW5mb3JtYXRpb24uXG5cbiAgICAgICAgLS1oZWxwICAgICAgICAgICAgICBTaG93IHRoaXMgbWVzc2FnZS5cblxuICAgIEFueSBhZGRpdGlvbmFsIG9wdGlvbiBpcyBwYXNzZWQgdG8gdGhlIFNjaGVtYXRpY3MgZGVwZW5kaW5nIG9uXG4gIGApO1xuXG4gIHByb2Nlc3MuZXhpdChleGl0Q29kZSk7XG4gIHRocm93IDA7ICAvLyBUaGUgbm9kZSB0eXBpbmcgc29tZXRpbWVzIGRvbid0IGhhdmUgYSBuZXZlciB0eXBlIGZvciBwcm9jZXNzLmV4aXQoKS5cbn1cblxuXG4vKipcbiAqIFBhcnNlIHRoZSBuYW1lIG9mIHNjaGVtYXRpYyBwYXNzZWQgaW4gYXJndW1lbnQsIGFuZCByZXR1cm4gYSB7Y29sbGVjdGlvbiwgc2NoZW1hdGljfSBuYW1lZFxuICogdHVwbGUuIFRoZSB1c2VyIGNhbiBwYXNzIGluIGBjb2xsZWN0aW9uLW5hbWU6c2NoZW1hdGljLW5hbWVgLCBhbmQgdGhpcyBmdW5jdGlvbiB3aWxsIGVpdGhlclxuICogcmV0dXJuIGB7Y29sbGVjdGlvbjogJ2NvbGxlY3Rpb24tbmFtZScsIHNjaGVtYXRpYzogJ3NjaGVtYXRpYy1uYW1lJ31gLCBvciBpdCB3aWxsIGVycm9yIG91dFxuICogYW5kIHNob3cgdXNhZ2UuXG4gKlxuICogSW4gdGhlIGNhc2Ugd2hlcmUgYSBjb2xsZWN0aW9uIG5hbWUgaXNuJ3QgcGFydCBvZiB0aGUgYXJndW1lbnQsIHRoZSBkZWZhdWx0IGlzIHRvIHVzZSB0aGVcbiAqIHNjaGVtYXRpY3MgcGFja2FnZSAoQHNjaGVtYXRpY3Mvc2NoZW1hdGljcykgYXMgdGhlIGNvbGxlY3Rpb24uXG4gKlxuICogVGhpcyBsb2dpYyBpcyBlbnRpcmVseSB1cCB0byB0aGUgdG9vbGluZy5cbiAqXG4gKiBAcGFyYW0gc3RyIFRoZSBhcmd1bWVudCB0byBwYXJzZS5cbiAqIEByZXR1cm4ge3tjb2xsZWN0aW9uOiBzdHJpbmcsIHNjaGVtYXRpYzogKHN0cmluZyl9fVxuICovXG5mdW5jdGlvbiBwYXJzZVNjaGVtYXRpY05hbWUoc3RyOiBzdHJpbmcgfCBudWxsKTogeyBjb2xsZWN0aW9uOiBzdHJpbmcsIHNjaGVtYXRpYzogc3RyaW5nIH0ge1xuICBsZXQgY29sbGVjdGlvbiA9ICdAc2NoZW1hdGljcy9zY2hlbWF0aWNzJztcblxuICBpZiAoIXN0ciB8fCBzdHIgPT09IG51bGwpIHtcbiAgICB1c2FnZSgxKTtcbiAgfVxuXG4gIGxldCBzY2hlbWF0aWM6IHN0cmluZyA9IHN0ciBhcyBzdHJpbmc7XG4gIGlmIChzY2hlbWF0aWMuaW5kZXhPZignOicpICE9IC0xKSB7XG4gICAgW2NvbGxlY3Rpb24sIHNjaGVtYXRpY10gPSBzY2hlbWF0aWMuc3BsaXQoJzonLCAyKTtcblxuICAgIGlmICghc2NoZW1hdGljKSB7XG4gICAgICB1c2FnZSgyKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4geyBjb2xsZWN0aW9uLCBzY2hlbWF0aWMgfTtcbn1cblxuXG4vKiogUGFyc2UgdGhlIGNvbW1hbmQgbGluZS4gKi9cbmNvbnN0IGJvb2xlYW5BcmdzID0gWyAnZGVidWcnLCAnZHJ5LXJ1bicsICdmb3JjZScsICdoZWxwJywgJ2xpc3Qtc2NoZW1hdGljcycsICd2ZXJib3NlJyBdO1xuY29uc3QgYXJndiA9IG1pbmltaXN0KHByb2Nlc3MuYXJndi5zbGljZSgyKSwge1xuICBib29sZWFuOiBib29sZWFuQXJncyxcbiAgZGVmYXVsdDoge1xuICAgICdkZWJ1Zyc6IG51bGwsXG4gICAgJ2RyeS1ydW4nOiBudWxsLFxuICB9LFxuICAnLS0nOiB0cnVlLFxufSk7XG5cbi8qKiBDcmVhdGUgdGhlIERldktpdCBMb2dnZXIgdXNlZCB0aHJvdWdoIHRoZSBDTEkuICovXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVDb25zb2xlTG9nZ2VyKGFyZ3ZbJ3ZlcmJvc2UnXSk7XG5cbmlmIChhcmd2LmhlbHApIHtcbiAgdXNhZ2UoKTtcbn1cblxuLyoqIEdldCB0aGUgY29sbGVjdGlvbiBhbiBzY2hlbWF0aWMgbmFtZSBmcm9tIHRoZSBmaXJzdCBhcmd1bWVudC4gKi9cbmNvbnN0IHtcbiAgY29sbGVjdGlvbjogY29sbGVjdGlvbk5hbWUsXG4gIHNjaGVtYXRpYzogc2NoZW1hdGljTmFtZSxcbn0gPSBwYXJzZVNjaGVtYXRpY05hbWUoYXJndi5fLnNoaWZ0KCkgfHwgbnVsbCk7XG5jb25zdCBpc0xvY2FsQ29sbGVjdGlvbiA9IGNvbGxlY3Rpb25OYW1lLnN0YXJ0c1dpdGgoJy4nKSB8fCBjb2xsZWN0aW9uTmFtZS5zdGFydHNXaXRoKCcvJyk7XG5cblxuLyoqIElmIHRoZSB1c2VyIHdhbnRzIHRvIGxpc3Qgc2NoZW1hdGljcywgd2Ugc2ltcGx5IHNob3cgYWxsIHRoZSBzY2hlbWF0aWMgbmFtZXMuICovXG5pZiAoYXJndlsnbGlzdC1zY2hlbWF0aWNzJ10pIHtcbiAgLy8gbG9nZ2VyLmluZm8oZW5naW5lLmxpc3RTY2hlbWF0aWNOYW1lcyhjb2xsZWN0aW9uKS5qb2luKCdcXG4nKSk7XG4gIHByb2Nlc3MuZXhpdCgwKTtcbiAgdGhyb3cgMDsgIC8vIFR5cGVTY3JpcHQgZG9lc24ndCBrbm93IHRoYXQgcHJvY2Vzcy5leGl0KCkgbmV2ZXIgcmV0dXJucy5cbn1cblxuXG4vKiogR2F0aGVyIHRoZSBhcmd1bWVudHMgZm9yIGxhdGVyIHVzZS4gKi9cbmNvbnN0IGRlYnVnOiBib29sZWFuID0gYXJndi5kZWJ1ZyA9PT0gbnVsbCA/IGlzTG9jYWxDb2xsZWN0aW9uIDogYXJndi5kZWJ1ZztcbmNvbnN0IGRyeVJ1bjogYm9vbGVhbiA9IGFyZ3ZbJ2RyeS1ydW4nXSA9PT0gbnVsbCA/IGRlYnVnIDogYXJndlsnZHJ5LXJ1biddO1xuY29uc3QgZm9yY2UgPSBhcmd2Wydmb3JjZSddO1xuXG4vKiogQ3JlYXRlIGEgVmlydHVhbCBGUyBIb3N0IHNjb3BlZCB0byB3aGVyZSB0aGUgcHJvY2VzcyBpcyBiZWluZyBydW4uICoqL1xuY29uc3QgZnNIb3N0ID0gbmV3IHZpcnR1YWxGcy5TY29wZWRIb3N0KG5ldyBOb2RlSnNTeW5jSG9zdCgpLCBub3JtYWxpemUocHJvY2Vzcy5jd2QoKSkpO1xuXG4vKiogQ3JlYXRlIHRoZSB3b3JrZmxvdyB0aGF0IHdpbGwgYmUgZXhlY3V0ZWQgd2l0aCB0aGlzIHJ1bi4gKi9cbmNvbnN0IHdvcmtmbG93ID0gbmV3IE5vZGVXb3JrZmxvdyhmc0hvc3QsIHsgZm9yY2UsIGRyeVJ1biB9KTtcblxuLy8gSW5kaWNhdGUgdG8gdGhlIHVzZXIgd2hlbiBub3RoaW5nIGhhcyBiZWVuIGRvbmUuIFRoaXMgaXMgYXV0b21hdGljYWxseSBzZXQgdG8gb2ZmIHdoZW4gdGhlcmUnc1xuLy8gYSBuZXcgRHJ5UnVuRXZlbnQuXG5sZXQgbm90aGluZ0RvbmUgPSB0cnVlO1xuXG4vLyBMb2dnaW5nIHF1ZXVlIHRoYXQgcmVjZWl2ZXMgYWxsIHRoZSBtZXNzYWdlcyB0byBzaG93IHRoZSB1c2Vycy4gVGhpcyBvbmx5IGdldCBzaG93biB3aGVuIG5vXG4vLyBlcnJvcnMgaGFwcGVuZWQuXG5jb25zdCBsb2dnaW5nUXVldWU6IHN0cmluZ1tdID0gW107XG5cbi8qKlxuICogTG9ncyBvdXQgZHJ5IHJ1biBldmVudHMuXG4gKlxuICogQWxsIGV2ZW50cyB3aWxsIGFsd2F5cyBiZSBleGVjdXRlZCBoZXJlLCBpbiBvcmRlciBvZiBkaXNjb3ZlcnkuIFRoYXQgbWVhbnMgdGhhdCBhbiBlcnJvciB3b3VsZFxuICogYmUgc2hvd24gYWxvbmcgb3RoZXIgZXZlbnRzIHdoZW4gaXQgaGFwcGVucy4gU2luY2UgZXJyb3JzIGluIHdvcmtmbG93cyB3aWxsIHN0b3AgdGhlIE9ic2VydmFibGVcbiAqIGZyb20gY29tcGxldGluZyBzdWNjZXNzZnVsbHksIHdlIHJlY29yZCBhbnkgZXZlbnRzIG90aGVyIHRoYW4gZXJyb3JzLCB0aGVuIG9uIGNvbXBsZXRpb24gd2VcbiAqIHNob3cgdGhlbS5cbiAqXG4gKiBUaGlzIGlzIGEgc2ltcGxlIHdheSB0byBvbmx5IHNob3cgZXJyb3JzIHdoZW4gYW4gZXJyb3Igb2NjdXIuXG4gKi9cbndvcmtmbG93LnJlcG9ydGVyLnN1YnNjcmliZSgoZXZlbnQ6IERyeVJ1bkV2ZW50KSA9PiB7XG4gIG5vdGhpbmdEb25lID0gZmFsc2U7XG5cbiAgc3dpdGNoIChldmVudC5raW5kKSB7XG4gICAgY2FzZSAnZXJyb3InOlxuICAgICAgY29uc3QgZGVzYyA9IGV2ZW50LmRlc2NyaXB0aW9uID09ICdhbHJlYWR5RXhpc3QnID8gJ2FscmVhZHkgZXhpc3RzJyA6ICdkb2VzIG5vdCBleGlzdC4nO1xuICAgICAgbG9nZ2VyLndhcm4oYEVSUk9SISAke2V2ZW50LnBhdGh9ICR7ZGVzY30uYCk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICd1cGRhdGUnOlxuICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2godGFncy5vbmVMaW5lYFxuICAgICAgICAke3Rlcm1pbmFsLndoaXRlKCdVUERBVEUnKX0gJHtldmVudC5wYXRofSAoJHtldmVudC5jb250ZW50Lmxlbmd0aH0gYnl0ZXMpXG4gICAgICBgKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICBsb2dnaW5nUXVldWUucHVzaCh0YWdzLm9uZUxpbmVgXG4gICAgICAgICR7dGVybWluYWwuZ3JlZW4oJ0NSRUFURScpfSAke2V2ZW50LnBhdGh9ICgke2V2ZW50LmNvbnRlbnQubGVuZ3RofSBieXRlcylcbiAgICAgIGApO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke3Rlcm1pbmFsLnllbGxvdygnREVMRVRFJyl9ICR7ZXZlbnQucGF0aH1gKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3JlbmFtZSc6XG4gICAgICBsb2dnaW5nUXVldWUucHVzaChgJHt0ZXJtaW5hbC5ibHVlKCdSRU5BTUUnKX0gJHtldmVudC5wYXRofSA9PiAke2V2ZW50LnRvfWApO1xuICAgICAgYnJlYWs7XG4gIH1cbn0pO1xuXG5cbi8qKlxuICogUmVtb3ZlIGV2ZXJ5IG9wdGlvbnMgZnJvbSBhcmd2IHRoYXQgd2Ugc3VwcG9ydCBpbiBzY2hlbWF0aWNzIGl0c2VsZi5cbiAqL1xuY29uc3QgYXJncyA9IE9iamVjdC5hc3NpZ24oe30sIGFyZ3YpO1xuZGVsZXRlIGFyZ3NbJy0tJ107XG5mb3IgKGNvbnN0IGtleSBvZiBib29sZWFuQXJncykge1xuICBkZWxldGUgYXJnc1trZXldO1xufVxuXG4vKipcbiAqIEFkZCBvcHRpb25zIGZyb20gYC0tYCB0byBhcmdzLlxuICovXG5jb25zdCBhcmd2MiA9IG1pbmltaXN0KGFyZ3ZbJy0tJ10pO1xuZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoYXJndjIpKSB7XG4gIGFyZ3Nba2V5XSA9IGFyZ3YyW2tleV07XG59XG5cbi8vIFBhc3MgdGhlIHJlc3Qgb2YgdGhlIGFyZ3VtZW50cyBhcyB0aGUgc21hcnQgZGVmYXVsdCBcImFyZ3ZcIi4gVGhlbiBkZWxldGUgaXQuXG53b3JrZmxvdy5yZWdpc3RyeS5hZGRTbWFydERlZmF1bHRQcm92aWRlcignYXJndicsIChzY2hlbWE6IEpzb25PYmplY3QpID0+IHtcbiAgaWYgKCdpbmRleCcgaW4gc2NoZW1hKSB7XG4gICAgcmV0dXJuIGFyZ3YuX1tOdW1iZXIoc2NoZW1hWydpbmRleCddKV07XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGFyZ3YuXztcbiAgfVxufSk7XG5kZWxldGUgYXJncy5fO1xuXG5cbi8qKlxuICogIEV4ZWN1dGUgdGhlIHdvcmtmbG93LCB3aGljaCB3aWxsIHJlcG9ydCB0aGUgZHJ5IHJ1biBldmVudHMsIHJ1biB0aGUgdGFza3MsIGFuZCBjb21wbGV0ZVxuICogIGFmdGVyIGFsbCBpcyBkb25lLlxuICpcbiAqICBUaGUgT2JzZXJ2YWJsZSByZXR1cm5lZCB3aWxsIHByb3Blcmx5IGNhbmNlbCB0aGUgd29ya2Zsb3cgaWYgdW5zdWJzY3JpYmVkLCBlcnJvciBvdXQgaWYgQU5ZXG4gKiAgc3RlcCBvZiB0aGUgd29ya2Zsb3cgZmFpbGVkIChzaW5rIG9yIHRhc2spLCB3aXRoIGRldGFpbHMgaW5jbHVkZWQsIGFuZCB3aWxsIG9ubHkgY29tcGxldGVcbiAqICB3aGVuIGV2ZXJ5dGhpbmcgaXMgZG9uZS5cbiAqL1xud29ya2Zsb3cuZXhlY3V0ZSh7XG4gIGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLFxuICBzY2hlbWF0aWM6IHNjaGVtYXRpY05hbWUsXG4gIG9wdGlvbnM6IGFyZ3MsXG4gIGRlYnVnOiBkZWJ1ZyxcbiAgbG9nZ2VyOiBsb2dnZXIsXG59KVxuLnN1YnNjcmliZSh7XG4gIGVycm9yKGVycjogRXJyb3IpIHtcbiAgICAvLyBJbiBjYXNlIHRoZSB3b3JrZmxvdyB3YXMgbm90IHN1Y2Nlc3NmdWwsIHNob3cgYW4gYXBwcm9wcmlhdGUgZXJyb3IgbWVzc2FnZS5cbiAgICBpZiAoZXJyIGluc3RhbmNlb2YgVW5zdWNjZXNzZnVsV29ya2Zsb3dFeGVjdXRpb24pIHtcbiAgICAgIC8vIFwiU2VlIGFib3ZlXCIgYmVjYXVzZSB3ZSBhbHJlYWR5IHByaW50ZWQgdGhlIGVycm9yLlxuICAgICAgbG9nZ2VyLmZhdGFsKCdUaGUgU2NoZW1hdGljIHdvcmtmbG93IGZhaWxlZC4gU2VlIGFib3ZlLicpO1xuICAgIH0gZWxzZSBpZiAoZGVidWcpIHtcbiAgICAgIGxvZ2dlci5mYXRhbCgnQW4gZXJyb3Igb2NjdXJlZDpcXG4nICsgZXJyLnN0YWNrKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbG9nZ2VyLmZhdGFsKGVyci5tZXNzYWdlKTtcbiAgICB9XG5cbiAgICBwcm9jZXNzLmV4aXQoMSk7XG4gIH0sXG4gIGNvbXBsZXRlKCkge1xuICAgIC8vIE91dHB1dCB0aGUgbG9nZ2luZyBxdWV1ZSwgbm8gZXJyb3IgaGFwcGVuZWQuXG4gICAgbG9nZ2luZ1F1ZXVlLmZvckVhY2gobG9nID0+IGxvZ2dlci5pbmZvKGxvZykpO1xuXG4gICAgaWYgKG5vdGhpbmdEb25lKSB7XG4gICAgICBsb2dnZXIuaW5mbygnTm90aGluZyB0byBiZSBkb25lLicpO1xuICAgIH1cbiAgfSxcbn0pO1xuIl19