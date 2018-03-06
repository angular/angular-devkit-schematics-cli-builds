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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIuLyIsInNvdXJjZXMiOlsicGFja2FnZXMvYW5ndWxhcl9kZXZraXQvc2NoZW1hdGljc19jbGkvYmluL3NjaGVtYXRpY3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBUUEsK0NBSzhCO0FBQzlCLG9EQUFnRjtBQUNoRiwyREFBd0Y7QUFDeEYsNERBQWdFO0FBQ2hFLHFDQUFxQztBQUdyQzs7R0FFRztBQUNILGVBQWUsUUFBUSxHQUFHLENBQUM7SUFDekIsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFJLENBQUMsV0FBVyxDQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQjNCLENBQUMsQ0FBQztJQUVILE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDdkIsTUFBTSxDQUFDLENBQUMsQ0FBRSx3RUFBd0U7QUFDcEYsQ0FBQztBQUdEOzs7Ozs7Ozs7Ozs7O0dBYUc7QUFDSCw0QkFBNEIsR0FBa0I7SUFDNUMsSUFBSSxVQUFVLEdBQUcsd0JBQXdCLENBQUM7SUFFMUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksR0FBRyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUM7UUFDekIsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ1gsQ0FBQztJQUVELElBQUksU0FBUyxHQUFXLEdBQWEsQ0FBQztJQUN0QyxFQUFFLENBQUMsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNqQyxDQUFDLFVBQVUsRUFBRSxTQUFTLENBQUMsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUVsRCxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7WUFDZixLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDWCxDQUFDO0lBQ0gsQ0FBQztJQUVELE1BQU0sQ0FBQyxF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Q0FBQyxJQUFJLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQztZQUM3QyxLQUFLLENBQUM7UUFDUixLQUFLLFFBQVE7WUFDWCxZQUFZLENBQUMsSUFBSSxDQUFDLFdBQUksQ0FBQyxPQUFPLENBQUE7VUFDMUIsZUFBUSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTTtPQUNsRSxDQUFDLENBQUM7WUFDSCxLQUFLLENBQUM7UUFDUixLQUFLLFFBQVE7WUFDWCxZQUFZLENBQUMsSUFBSSxDQUFDLFdBQUksQ0FBQyxPQUFPLENBQUE7VUFDMUIsZUFBUSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTTtPQUNsRSxDQUFDLENBQUM7WUFDSCxLQUFLLENBQUM7UUFDUixLQUFLLFFBQVE7WUFDWCxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsZUFBUSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUNoRSxLQUFLLENBQUM7UUFDUixLQUFLLFFBQVE7WUFDWCxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsZUFBUSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxPQUFPLEtBQUssQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQzdFLEtBQUssQ0FBQztJQUNWLENBQUM7QUFDSCxDQUFDLENBQUMsQ0FBQztBQUdIOztHQUVHO0FBQ0gsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQUM7QUFDckMsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDbEIsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLElBQUksV0FBVyxDQUFDLENBQUMsQ0FBQztJQUM5QixPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUNuQixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxNQUFNLEtBQUssR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7QUFDbkMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDckMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUN6QixDQUFDO0FBQ0QsT0FBTyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBR2Q7Ozs7Ozs7R0FPRztBQUNILFFBQVEsQ0FBQyxPQUFPLENBQUM7SUFDZixVQUFVLEVBQUUsY0FBYztJQUMxQixTQUFTLEVBQUUsYUFBYTtJQUN4QixPQUFPLEVBQUUsSUFBSTtJQUNiLEtBQUssRUFBRSxLQUFLO0lBQ1osTUFBTSxFQUFFLE1BQU07Q0FDZixDQUFDO0tBQ0QsU0FBUyxDQUFDO0lBQ1QsS0FBSyxDQUFDLEdBQVU7UUFDZCw4RUFBOEU7UUFDOUUsRUFBRSxDQUFDLENBQUMsR0FBRyxZQUFZLDBDQUE2QixDQUFDLENBQUMsQ0FBQztZQUNqRCxvREFBb0Q7WUFDcEQsTUFBTSxDQUFDLEtBQUssQ0FBQywyQ0FBMkMsQ0FBQyxDQUFDO1FBQzVELENBQUM7UUFBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztZQUNqQixNQUFNLENBQUMsS0FBSyxDQUFDLHFCQUFxQixHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNsRCxDQUFDO1FBQUMsSUFBSSxDQUFDLENBQUM7WUFDTixNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUM1QixDQUFDO1FBRUQsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNsQixDQUFDO0lBQ0QsUUFBUTtRQUNOLCtDQUErQztRQUMvQyxZQUFZLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBRTlDLEVBQUUsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7WUFDaEIsTUFBTSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO1FBQ3JDLENBQUM7SUFDSCxDQUFDO0NBQ0YsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuaW1wb3J0IHtcbiAgbm9ybWFsaXplLFxuICB0YWdzLFxuICB0ZXJtaW5hbCxcbiAgdmlydHVhbEZzLFxufSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZSc7XG5pbXBvcnQgeyBOb2RlSnNTeW5jSG9zdCwgY3JlYXRlQ29uc29sZUxvZ2dlciB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlL25vZGUnO1xuaW1wb3J0IHsgRHJ5UnVuRXZlbnQsIFVuc3VjY2Vzc2Z1bFdvcmtmbG93RXhlY3V0aW9uIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MnO1xuaW1wb3J0IHsgTm9kZVdvcmtmbG93IH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MvdG9vbHMnO1xuaW1wb3J0ICogYXMgbWluaW1pc3QgZnJvbSAnbWluaW1pc3QnO1xuXG5cbi8qKlxuICogU2hvdyB1c2FnZSBvZiB0aGUgQ0xJIHRvb2wsIGFuZCBleGl0IHRoZSBwcm9jZXNzLlxuICovXG5mdW5jdGlvbiB1c2FnZShleGl0Q29kZSA9IDApOiBuZXZlciB7XG4gIGxvZ2dlci5pbmZvKHRhZ3Muc3RyaXBJbmRlbnRgXG4gICAgc2NoZW1hdGljcyBbQ29sbGVjdGlvbk5hbWU6XVNjaGVtYXRpY05hbWUgW29wdGlvbnMsIC4uLl1cblxuICAgIEJ5IGRlZmF1bHQsIGlmIHRoZSBjb2xsZWN0aW9uIG5hbWUgaXMgbm90IHNwZWNpZmllZCwgdXNlIHRoZSBpbnRlcm5hbCBjb2xsZWN0aW9uIHByb3ZpZGVkXG4gICAgYnkgdGhlIFNjaGVtYXRpY3MgQ0xJLlxuXG4gICAgT3B0aW9uczpcbiAgICAgICAgLS1kZWJ1ZyAgICAgICAgICAgICBEZWJ1ZyBtb2RlLiBUaGlzIGlzIHRydWUgYnkgZGVmYXVsdCBpZiB0aGUgY29sbGVjdGlvbiBpcyBhIHJlbGF0aXZlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aCAoaW4gdGhhdCBjYXNlLCB0dXJuIG9mZiB3aXRoIC0tZGVidWc9ZmFsc2UpLlxuICAgICAgICAtLWRyeS1ydW4gICAgICAgICAgIERvIG5vdCBvdXRwdXQgYW55dGhpbmcsIGJ1dCBpbnN0ZWFkIGp1c3Qgc2hvdyB3aGF0IGFjdGlvbnMgd291bGQgYmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJmb3JtZWQuIERlZmF1bHQgdG8gdHJ1ZSBpZiBkZWJ1ZyBpcyBhbHNvIHRydWUuXG4gICAgICAgIC0tZm9yY2UgICAgICAgICAgICAgRm9yY2Ugb3ZlcndyaXRpbmcgZmlsZXMgdGhhdCB3b3VsZCBvdGhlcndpc2UgYmUgYW4gZXJyb3IuXG4gICAgICAgIC0tbGlzdC1zY2hlbWF0aWNzICAgTGlzdCBhbGwgc2NoZW1hdGljcyBmcm9tIHRoZSBjb2xsZWN0aW9uLCBieSBuYW1lLlxuICAgICAgICAtLXZlcmJvc2UgICAgICAgICAgIFNob3cgbW9yZSBpbmZvcm1hdGlvbi5cblxuICAgICAgICAtLWhlbHAgICAgICAgICAgICAgIFNob3cgdGhpcyBtZXNzYWdlLlxuXG4gICAgQW55IGFkZGl0aW9uYWwgb3B0aW9uIGlzIHBhc3NlZCB0byB0aGUgU2NoZW1hdGljcyBkZXBlbmRpbmcgb25cbiAgYCk7XG5cbiAgcHJvY2Vzcy5leGl0KGV4aXRDb2RlKTtcbiAgdGhyb3cgMDsgIC8vIFRoZSBub2RlIHR5cGluZyBzb21ldGltZXMgZG9uJ3QgaGF2ZSBhIG5ldmVyIHR5cGUgZm9yIHByb2Nlc3MuZXhpdCgpLlxufVxuXG5cbi8qKlxuICogUGFyc2UgdGhlIG5hbWUgb2Ygc2NoZW1hdGljIHBhc3NlZCBpbiBhcmd1bWVudCwgYW5kIHJldHVybiBhIHtjb2xsZWN0aW9uLCBzY2hlbWF0aWN9IG5hbWVkXG4gKiB0dXBsZS4gVGhlIHVzZXIgY2FuIHBhc3MgaW4gYGNvbGxlY3Rpb24tbmFtZTpzY2hlbWF0aWMtbmFtZWAsIGFuZCB0aGlzIGZ1bmN0aW9uIHdpbGwgZWl0aGVyXG4gKiByZXR1cm4gYHtjb2xsZWN0aW9uOiAnY29sbGVjdGlvbi1uYW1lJywgc2NoZW1hdGljOiAnc2NoZW1hdGljLW5hbWUnfWAsIG9yIGl0IHdpbGwgZXJyb3Igb3V0XG4gKiBhbmQgc2hvdyB1c2FnZS5cbiAqXG4gKiBJbiB0aGUgY2FzZSB3aGVyZSBhIGNvbGxlY3Rpb24gbmFtZSBpc24ndCBwYXJ0IG9mIHRoZSBhcmd1bWVudCwgdGhlIGRlZmF1bHQgaXMgdG8gdXNlIHRoZVxuICogc2NoZW1hdGljcyBwYWNrYWdlIChAc2NoZW1hdGljcy9zY2hlbWF0aWNzKSBhcyB0aGUgY29sbGVjdGlvbi5cbiAqXG4gKiBUaGlzIGxvZ2ljIGlzIGVudGlyZWx5IHVwIHRvIHRoZSB0b29saW5nLlxuICpcbiAqIEBwYXJhbSBzdHIgVGhlIGFyZ3VtZW50IHRvIHBhcnNlLlxuICogQHJldHVybiB7e2NvbGxlY3Rpb246IHN0cmluZywgc2NoZW1hdGljOiAoc3RyaW5nKX19XG4gKi9cbmZ1bmN0aW9uIHBhcnNlU2NoZW1hdGljTmFtZShzdHI6IHN0cmluZyB8IG51bGwpOiB7IGNvbGxlY3Rpb246IHN0cmluZywgc2NoZW1hdGljOiBzdHJpbmcgfSB7XG4gIGxldCBjb2xsZWN0aW9uID0gJ0BzY2hlbWF0aWNzL3NjaGVtYXRpY3MnO1xuXG4gIGlmICghc3RyIHx8IHN0ciA9PT0gbnVsbCkge1xuICAgIHVzYWdlKDEpO1xuICB9XG5cbiAgbGV0IHNjaGVtYXRpYzogc3RyaW5nID0gc3RyIGFzIHN0cmluZztcbiAgaWYgKHNjaGVtYXRpYy5pbmRleE9mKCc6JykgIT0gLTEpIHtcbiAgICBbY29sbGVjdGlvbiwgc2NoZW1hdGljXSA9IHNjaGVtYXRpYy5zcGxpdCgnOicsIDIpO1xuXG4gICAgaWYgKCFzY2hlbWF0aWMpIHtcbiAgICAgIHVzYWdlKDIpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7IGNvbGxlY3Rpb24sIHNjaGVtYXRpYyB9O1xufVxuXG5cbi8qKiBQYXJzZSB0aGUgY29tbWFuZCBsaW5lLiAqL1xuY29uc3QgYm9vbGVhbkFyZ3MgPSBbICdkZWJ1ZycsICdkcnktcnVuJywgJ2ZvcmNlJywgJ2hlbHAnLCAnbGlzdC1zY2hlbWF0aWNzJywgJ3ZlcmJvc2UnIF07XG5jb25zdCBhcmd2ID0gbWluaW1pc3QocHJvY2Vzcy5hcmd2LnNsaWNlKDIpLCB7XG4gIGJvb2xlYW46IGJvb2xlYW5BcmdzLFxuICBkZWZhdWx0OiB7XG4gICAgJ2RlYnVnJzogbnVsbCxcbiAgICAnZHJ5LXJ1bic6IG51bGwsXG4gIH0sXG4gICctLSc6IHRydWUsXG59KTtcblxuLyoqIENyZWF0ZSB0aGUgRGV2S2l0IExvZ2dlciB1c2VkIHRocm91Z2ggdGhlIENMSS4gKi9cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUNvbnNvbGVMb2dnZXIoYXJndlsndmVyYm9zZSddKTtcblxuaWYgKGFyZ3YuaGVscCkge1xuICB1c2FnZSgpO1xufVxuXG4vKiogR2V0IHRoZSBjb2xsZWN0aW9uIGFuIHNjaGVtYXRpYyBuYW1lIGZyb20gdGhlIGZpcnN0IGFyZ3VtZW50LiAqL1xuY29uc3Qge1xuICBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSxcbiAgc2NoZW1hdGljOiBzY2hlbWF0aWNOYW1lLFxufSA9IHBhcnNlU2NoZW1hdGljTmFtZShhcmd2Ll8uc2hpZnQoKSB8fCBudWxsKTtcbmNvbnN0IGlzTG9jYWxDb2xsZWN0aW9uID0gY29sbGVjdGlvbk5hbWUuc3RhcnRzV2l0aCgnLicpIHx8IGNvbGxlY3Rpb25OYW1lLnN0YXJ0c1dpdGgoJy8nKTtcblxuXG4vKiogSWYgdGhlIHVzZXIgd2FudHMgdG8gbGlzdCBzY2hlbWF0aWNzLCB3ZSBzaW1wbHkgc2hvdyBhbGwgdGhlIHNjaGVtYXRpYyBuYW1lcy4gKi9cbmlmIChhcmd2WydsaXN0LXNjaGVtYXRpY3MnXSkge1xuICAvLyBsb2dnZXIuaW5mbyhlbmdpbmUubGlzdFNjaGVtYXRpY05hbWVzKGNvbGxlY3Rpb24pLmpvaW4oJ1xcbicpKTtcbiAgcHJvY2Vzcy5leGl0KDApO1xuICB0aHJvdyAwOyAgLy8gVHlwZVNjcmlwdCBkb2Vzbid0IGtub3cgdGhhdCBwcm9jZXNzLmV4aXQoKSBuZXZlciByZXR1cm5zLlxufVxuXG5cbi8qKiBHYXRoZXIgdGhlIGFyZ3VtZW50cyBmb3IgbGF0ZXIgdXNlLiAqL1xuY29uc3QgZGVidWc6IGJvb2xlYW4gPSBhcmd2LmRlYnVnID09PSBudWxsID8gaXNMb2NhbENvbGxlY3Rpb24gOiBhcmd2LmRlYnVnO1xuY29uc3QgZHJ5UnVuOiBib29sZWFuID0gYXJndlsnZHJ5LXJ1biddID09PSBudWxsID8gZGVidWcgOiBhcmd2WydkcnktcnVuJ107XG5jb25zdCBmb3JjZSA9IGFyZ3ZbJ2ZvcmNlJ107XG5cbi8qKiBDcmVhdGUgYSBWaXJ0dWFsIEZTIEhvc3Qgc2NvcGVkIHRvIHdoZXJlIHRoZSBwcm9jZXNzIGlzIGJlaW5nIHJ1bi4gKiovXG5jb25zdCBmc0hvc3QgPSBuZXcgdmlydHVhbEZzLlNjb3BlZEhvc3QobmV3IE5vZGVKc1N5bmNIb3N0KCksIG5vcm1hbGl6ZShwcm9jZXNzLmN3ZCgpKSk7XG5cbi8qKiBDcmVhdGUgdGhlIHdvcmtmbG93IHRoYXQgd2lsbCBiZSBleGVjdXRlZCB3aXRoIHRoaXMgcnVuLiAqL1xuY29uc3Qgd29ya2Zsb3cgPSBuZXcgTm9kZVdvcmtmbG93KGZzSG9zdCwgeyBmb3JjZSwgZHJ5UnVuIH0pO1xuXG4vLyBJbmRpY2F0ZSB0byB0aGUgdXNlciB3aGVuIG5vdGhpbmcgaGFzIGJlZW4gZG9uZS4gVGhpcyBpcyBhdXRvbWF0aWNhbGx5IHNldCB0byBvZmYgd2hlbiB0aGVyZSdzXG4vLyBhIG5ldyBEcnlSdW5FdmVudC5cbmxldCBub3RoaW5nRG9uZSA9IHRydWU7XG5cbi8vIExvZ2dpbmcgcXVldWUgdGhhdCByZWNlaXZlcyBhbGwgdGhlIG1lc3NhZ2VzIHRvIHNob3cgdGhlIHVzZXJzLiBUaGlzIG9ubHkgZ2V0IHNob3duIHdoZW4gbm9cbi8vIGVycm9ycyBoYXBwZW5lZC5cbmNvbnN0IGxvZ2dpbmdRdWV1ZTogc3RyaW5nW10gPSBbXTtcblxuLyoqXG4gKiBMb2dzIG91dCBkcnkgcnVuIGV2ZW50cy5cbiAqXG4gKiBBbGwgZXZlbnRzIHdpbGwgYWx3YXlzIGJlIGV4ZWN1dGVkIGhlcmUsIGluIG9yZGVyIG9mIGRpc2NvdmVyeS4gVGhhdCBtZWFucyB0aGF0IGFuIGVycm9yIHdvdWxkXG4gKiBiZSBzaG93biBhbG9uZyBvdGhlciBldmVudHMgd2hlbiBpdCBoYXBwZW5zLiBTaW5jZSBlcnJvcnMgaW4gd29ya2Zsb3dzIHdpbGwgc3RvcCB0aGUgT2JzZXJ2YWJsZVxuICogZnJvbSBjb21wbGV0aW5nIHN1Y2Nlc3NmdWxseSwgd2UgcmVjb3JkIGFueSBldmVudHMgb3RoZXIgdGhhbiBlcnJvcnMsIHRoZW4gb24gY29tcGxldGlvbiB3ZVxuICogc2hvdyB0aGVtLlxuICpcbiAqIFRoaXMgaXMgYSBzaW1wbGUgd2F5IHRvIG9ubHkgc2hvdyBlcnJvcnMgd2hlbiBhbiBlcnJvciBvY2N1ci5cbiAqL1xud29ya2Zsb3cucmVwb3J0ZXIuc3Vic2NyaWJlKChldmVudDogRHJ5UnVuRXZlbnQpID0+IHtcbiAgbm90aGluZ0RvbmUgPSBmYWxzZTtcblxuICBzd2l0Y2ggKGV2ZW50LmtpbmQpIHtcbiAgICBjYXNlICdlcnJvcic6XG4gICAgICBjb25zdCBkZXNjID0gZXZlbnQuZGVzY3JpcHRpb24gPT0gJ2FscmVhZHlFeGlzdCcgPyAnYWxyZWFkeSBleGlzdHMnIDogJ2RvZXMgbm90IGV4aXN0Lic7XG4gICAgICBsb2dnZXIud2FybihgRVJST1IhICR7ZXZlbnQucGF0aH0gJHtkZXNjfS5gKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICBsb2dnaW5nUXVldWUucHVzaCh0YWdzLm9uZUxpbmVgXG4gICAgICAgICR7dGVybWluYWwud2hpdGUoJ1VQREFURScpfSAke2V2ZW50LnBhdGh9ICgke2V2ZW50LmNvbnRlbnQubGVuZ3RofSBieXRlcylcbiAgICAgIGApO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKHRhZ3Mub25lTGluZWBcbiAgICAgICAgJHt0ZXJtaW5hbC5ncmVlbignQ1JFQVRFJyl9ICR7ZXZlbnQucGF0aH0gKCR7ZXZlbnQuY29udGVudC5sZW5ndGh9IGJ5dGVzKVxuICAgICAgYCk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdkZWxldGUnOlxuICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7dGVybWluYWwueWVsbG93KCdERUxFVEUnKX0gJHtldmVudC5wYXRofWApO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAncmVuYW1lJzpcbiAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke3Rlcm1pbmFsLmJsdWUoJ1JFTkFNRScpfSAke2V2ZW50LnBhdGh9ID0+ICR7ZXZlbnQudG99YCk7XG4gICAgICBicmVhaztcbiAgfVxufSk7XG5cblxuLyoqXG4gKiBSZW1vdmUgZXZlcnkgb3B0aW9ucyBmcm9tIGFyZ3YgdGhhdCB3ZSBzdXBwb3J0IGluIHNjaGVtYXRpY3MgaXRzZWxmLlxuICovXG5jb25zdCBhcmdzID0gT2JqZWN0LmFzc2lnbih7fSwgYXJndik7XG5kZWxldGUgYXJnc1snLS0nXTtcbmZvciAoY29uc3Qga2V5IG9mIGJvb2xlYW5BcmdzKSB7XG4gIGRlbGV0ZSBhcmdzW2tleV07XG59XG5cbi8qKlxuICogQWRkIG9wdGlvbnMgZnJvbSBgLS1gIHRvIGFyZ3MuXG4gKi9cbmNvbnN0IGFyZ3YyID0gbWluaW1pc3QoYXJndlsnLS0nXSk7XG5mb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhhcmd2MikpIHtcbiAgYXJnc1trZXldID0gYXJndjJba2V5XTtcbn1cbmRlbGV0ZSBhcmdzLl87XG5cblxuLyoqXG4gKiAgRXhlY3V0ZSB0aGUgd29ya2Zsb3csIHdoaWNoIHdpbGwgcmVwb3J0IHRoZSBkcnkgcnVuIGV2ZW50cywgcnVuIHRoZSB0YXNrcywgYW5kIGNvbXBsZXRlXG4gKiAgYWZ0ZXIgYWxsIGlzIGRvbmUuXG4gKlxuICogIFRoZSBPYnNlcnZhYmxlIHJldHVybmVkIHdpbGwgcHJvcGVybHkgY2FuY2VsIHRoZSB3b3JrZmxvdyBpZiB1bnN1YnNjcmliZWQsIGVycm9yIG91dCBpZiBBTllcbiAqICBzdGVwIG9mIHRoZSB3b3JrZmxvdyBmYWlsZWQgKHNpbmsgb3IgdGFzayksIHdpdGggZGV0YWlscyBpbmNsdWRlZCwgYW5kIHdpbGwgb25seSBjb21wbGV0ZVxuICogIHdoZW4gZXZlcnl0aGluZyBpcyBkb25lLlxuICovXG53b3JrZmxvdy5leGVjdXRlKHtcbiAgY29sbGVjdGlvbjogY29sbGVjdGlvbk5hbWUsXG4gIHNjaGVtYXRpYzogc2NoZW1hdGljTmFtZSxcbiAgb3B0aW9uczogYXJncyxcbiAgZGVidWc6IGRlYnVnLFxuICBsb2dnZXI6IGxvZ2dlcixcbn0pXG4uc3Vic2NyaWJlKHtcbiAgZXJyb3IoZXJyOiBFcnJvcikge1xuICAgIC8vIEluIGNhc2UgdGhlIHdvcmtmbG93IHdhcyBub3Qgc3VjY2Vzc2Z1bCwgc2hvdyBhbiBhcHByb3ByaWF0ZSBlcnJvciBtZXNzYWdlLlxuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBVbnN1Y2Nlc3NmdWxXb3JrZmxvd0V4ZWN1dGlvbikge1xuICAgICAgLy8gXCJTZWUgYWJvdmVcIiBiZWNhdXNlIHdlIGFscmVhZHkgcHJpbnRlZCB0aGUgZXJyb3IuXG4gICAgICBsb2dnZXIuZmF0YWwoJ1RoZSBTY2hlbWF0aWMgd29ya2Zsb3cgZmFpbGVkLiBTZWUgYWJvdmUuJyk7XG4gICAgfSBlbHNlIGlmIChkZWJ1Zykge1xuICAgICAgbG9nZ2VyLmZhdGFsKCdBbiBlcnJvciBvY2N1cmVkOlxcbicgKyBlcnIuc3RhY2spO1xuICAgIH0gZWxzZSB7XG4gICAgICBsb2dnZXIuZmF0YWwoZXJyLm1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgfSxcbiAgY29tcGxldGUoKSB7XG4gICAgLy8gT3V0cHV0IHRoZSBsb2dnaW5nIHF1ZXVlLCBubyBlcnJvciBoYXBwZW5lZC5cbiAgICBsb2dnaW5nUXVldWUuZm9yRWFjaChsb2cgPT4gbG9nZ2VyLmluZm8obG9nKSk7XG5cbiAgICBpZiAobm90aGluZ0RvbmUpIHtcbiAgICAgIGxvZ2dlci5pbmZvKCdOb3RoaW5nIHRvIGJlIGRvbmUuJyk7XG4gICAgfVxuICB9LFxufSk7XG4iXX0=