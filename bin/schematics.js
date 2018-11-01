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
    let schematic = str;
    if (schematic && schematic.indexOf(':') != -1) {
        [collection, schematic] = schematic.split(':', 2);
    }
    return { collection, schematic };
}
async function main({ args, stdout = process.stdout, stderr = process.stderr, }) {
    const argv = parseArgs(args);
    /** Create the DevKit Logger used through the CLI. */
    const logger = node_1.createConsoleLogger(argv['verbose'], stdout, stderr);
    if (argv.help) {
        logger.info(getUsage());
        return 0;
    }
    /** Get the collection an schematic name from the first argument. */
    const { collection: collectionName, schematic: schematicName, } = parseSchematicName(argv._.shift() || null);
    const isLocalCollection = collectionName.startsWith('.') || collectionName.startsWith('/');
    /** If the user wants to list schematics, we simply show all the schematic names. */
    if (argv['list-schematics']) {
        try {
            const engineHost = new tools_1.NodeModulesEngineHost();
            const engine = new schematics_1.SchematicEngine(engineHost);
            const collection = engine.createCollection(collectionName);
            logger.info(engine.listSchematicNames(collection).join('\n'));
        }
        catch (error) {
            logger.fatal(error.message);
            return 1;
        }
        return 0;
    }
    if (!schematicName) {
        logger.info(getUsage());
        return 1;
    }
    /** Gather the arguments for later use. */
    const debug = argv.debug === null ? isLocalCollection : argv.debug;
    const dryRun = argv['dry-run'] === null ? debug : argv['dry-run'];
    const force = argv['force'];
    const allowPrivate = argv['allow-private'];
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
    const parsedArgs = Object.assign({}, argv);
    delete parsedArgs['--'];
    for (const key of booleanArgs) {
        delete parsedArgs[key];
    }
    /**
     * Add options from `--` to args.
     */
    const argv2 = minimist(argv['--']);
    for (const key of Object.keys(argv2)) {
        parsedArgs[key] = argv2[key];
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
    delete parsedArgs._;
    /**
     *  Execute the workflow, which will report the dry run events, run the tasks, and complete
     *  after all is done.
     *
     *  The Observable returned will properly cancel the workflow if unsubscribed, error out if ANY
     *  step of the workflow failed (sink or task), with details included, and will only complete
     *  when everything is done.
     */
    try {
        await workflow.execute({
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
                          should be suffixed by a colon. Example: '@schematics/schematics:'.

      --verbose           Show more information.

      --help              Show this message.

  Any additional option is passed to the Schematics depending on
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
];
function parseArgs(args) {
    return minimist(args, {
        boolean: booleanArgs,
        alias: {
            'dryRun': 'dry-run',
            'listSchematics': 'list-schematics',
            'allowPrivate': 'allow-private',
        },
        default: {
            'debug': null,
            'dry-run': null,
        },
        '--': true,
    });
}
if (require.main === module) {
    const args = process.argv.slice(2);
    main({ args })
        .then(exitCode => process.exitCode = exitCode)
        .catch(e => { throw (e); });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIuLyIsInNvdXJjZXMiOlsicGFja2FnZXMvYW5ndWxhcl9kZXZraXQvc2NoZW1hdGljc19jbGkvYmluL3NjaGVtYXRpY3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBU0EsNkJBQTJCO0FBQzNCLGdDQUFnQztBQUNoQyx5REFBeUQ7QUFDekQsK0NBTThCO0FBQzlCLG9EQUErRjtBQUMvRiwyREFJb0M7QUFDcEMsNERBQXVGO0FBQ3ZGLHFDQUFxQztBQUdyQzs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxHQUFrQjtJQUM1QyxJQUFJLFVBQVUsR0FBRyx3QkFBd0IsQ0FBQztJQUUxQyxJQUFJLFNBQVMsR0FBRyxHQUFHLENBQUM7SUFDcEIsSUFBSSxTQUFTLElBQUksU0FBUyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsRUFBRTtRQUM3QyxDQUFDLFVBQVUsRUFBRSxTQUFTLENBQUMsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQztLQUNuRDtJQUVELE9BQU8sRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFDbkMsQ0FBQztBQVNNLEtBQUssVUFBVSxJQUFJLENBQUMsRUFDekIsSUFBSSxFQUNKLE1BQU0sR0FBRyxPQUFPLENBQUMsTUFBTSxFQUN2QixNQUFNLEdBQUcsT0FBTyxDQUFDLE1BQU0sR0FDWDtJQUVaLE1BQU0sSUFBSSxHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUU3QixxREFBcUQ7SUFDckQsTUFBTSxNQUFNLEdBQUcsMEJBQW1CLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztJQUNwRSxJQUFJLElBQUksQ0FBQyxJQUFJLEVBQUU7UUFDYixNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFF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WUFDbkMsY0FBYyxFQUFFLGVBQWU7U0FDaEM7UUFDRCxPQUFPLEVBQUU7WUFDUCxPQUFPLEVBQUUsSUFBSTtZQUNiLFNBQVMsRUFBRSxJQUFJO1NBQ2hCO1FBQ0QsSUFBSSxFQUFFLElBQUk7S0FDWCxDQUFDLENBQUM7QUFDUCxDQUFDO0FBRUQsSUFBSSxPQUFPLENBQUMsSUFBSSxLQUFLLE1BQU0sRUFBRTtJQUMzQixNQUFNLElBQUksR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNuQyxJQUFJLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQztTQUNYLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1NBQzdDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0NBQy9CIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgJ3N5bWJvbC1vYnNlcnZhYmxlJztcbi8vIHN5bWJvbCBwb2x5ZmlsbCBtdXN0IGdvIGZpcnN0XG4vLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6b3JkZXJlZC1pbXBvcnRzIGltcG9ydC1ncm91cHNcbmltcG9ydCB7XG4gIEpzb25PYmplY3QsXG4gIG5vcm1hbGl6ZSxcbiAgdGFncyxcbiAgdGVybWluYWwsXG4gIHZpcnR1YWxGcyxcbn0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgTm9kZUpzU3luY0hvc3QsIFByb2Nlc3NPdXRwdXQsIGNyZWF0ZUNvbnNvbGVMb2dnZXIgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZS9ub2RlJztcbmltcG9ydCB7XG4gIERyeVJ1bkV2ZW50LFxuICBTY2hlbWF0aWNFbmdpbmUsXG4gIFVuc3VjY2Vzc2Z1bFdvcmtmbG93RXhlY3V0aW9uLFxufSBmcm9tICdAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcyc7XG5pbXBvcnQgeyBOb2RlTW9kdWxlc0VuZ2luZUhvc3QsIE5vZGVXb3JrZmxvdyB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzL3Rvb2xzJztcbmltcG9ydCAqIGFzIG1pbmltaXN0IGZyb20gJ21pbmltaXN0JztcblxuXG4vKipcbiAqIFBhcnNlIHRoZSBuYW1lIG9mIHNjaGVtYXRpYyBwYXNzZWQgaW4gYXJndW1lbnQsIGFuZCByZXR1cm4gYSB7Y29sbGVjdGlvbiwgc2NoZW1hdGljfSBuYW1lZFxuICogdHVwbGUuIFRoZSB1c2VyIGNhbiBwYXNzIGluIGBjb2xsZWN0aW9uLW5hbWU6c2NoZW1hdGljLW5hbWVgLCBhbmQgdGhpcyBmdW5jdGlvbiB3aWxsIGVpdGhlclxuICogcmV0dXJuIGB7Y29sbGVjdGlvbjogJ2NvbGxlY3Rpb24tbmFtZScsIHNjaGVtYXRpYzogJ3NjaGVtYXRpYy1uYW1lJ31gLCBvciBpdCB3aWxsIGVycm9yIG91dFxuICogYW5kIHNob3cgdXNhZ2UuXG4gKlxuICogSW4gdGhlIGNhc2Ugd2hlcmUgYSBjb2xsZWN0aW9uIG5hbWUgaXNuJ3QgcGFydCBvZiB0aGUgYXJndW1lbnQsIHRoZSBkZWZhdWx0IGlzIHRvIHVzZSB0aGVcbiAqIHNjaGVtYXRpY3MgcGFja2FnZSAoQHNjaGVtYXRpY3Mvc2NoZW1hdGljcykgYXMgdGhlIGNvbGxlY3Rpb24uXG4gKlxuICogVGhpcyBsb2dpYyBpcyBlbnRpcmVseSB1cCB0byB0aGUgdG9vbGluZy5cbiAqXG4gKiBAcGFyYW0gc3RyIFRoZSBhcmd1bWVudCB0byBwYXJzZS5cbiAqIEByZXR1cm4ge3tjb2xsZWN0aW9uOiBzdHJpbmcsIHNjaGVtYXRpYzogKHN0cmluZyl9fVxuICovXG5mdW5jdGlvbiBwYXJzZVNjaGVtYXRpY05hbWUoc3RyOiBzdHJpbmcgfCBudWxsKTogeyBjb2xsZWN0aW9uOiBzdHJpbmcsIHNjaGVtYXRpYzogc3RyaW5nIHwgbnVsbCB9IHtcbiAgbGV0IGNvbGxlY3Rpb24gPSAnQHNjaGVtYXRpY3Mvc2NoZW1hdGljcyc7XG5cbiAgbGV0IHNjaGVtYXRpYyA9IHN0cjtcbiAgaWYgKHNjaGVtYXRpYyAmJiBzY2hlbWF0aWMuaW5kZXhPZignOicpICE9IC0xKSB7XG4gICAgW2NvbGxlY3Rpb24sIHNjaGVtYXRpY10gPSBzY2hlbWF0aWMuc3BsaXQoJzonLCAyKTtcbiAgfVxuXG4gIHJldHVybiB7IGNvbGxlY3Rpb24sIHNjaGVtYXRpYyB9O1xufVxuXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWFpbk9wdGlvbnMge1xuICBhcmdzOiBzdHJpbmdbXTtcbiAgc3Rkb3V0PzogUHJvY2Vzc091dHB1dDtcbiAgc3RkZXJyPzogUHJvY2Vzc091dHB1dDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1haW4oe1xuICBhcmdzLFxuICBzdGRvdXQgPSBwcm9jZXNzLnN0ZG91dCxcbiAgc3RkZXJyID0gcHJvY2Vzcy5zdGRlcnIsXG59OiBNYWluT3B0aW9ucyk6IFByb21pc2U8MCB8IDE+IHtcblxuICBjb25zdCBhcmd2ID0gcGFyc2VBcmdzKGFyZ3MpO1xuXG4gIC8qKiBDcmVhdGUgdGhlIERldktpdCBMb2dnZXIgdXNlZCB0aHJvdWdoIHRoZSBDTEkuICovXG4gIGNvbnN0IGxvZ2dlciA9IGNyZWF0ZUNvbnNvbGVMb2dnZXIoYXJndlsndmVyYm9zZSddLCBzdGRvdXQsIHN0ZGVycik7XG4gIGlmIChhcmd2LmhlbHApIHtcbiAgICBsb2dnZXIuaW5mbyhnZXRVc2FnZSgpKTtcblxuICAgIHJldHVybiAwO1xuICB9XG5cbiAgLyoqIEdldCB0aGUgY29sbGVjdGlvbiBhbiBzY2hlbWF0aWMgbmFtZSBmcm9tIHRoZSBmaXJzdCBhcmd1bWVudC4gKi9cbiAgY29uc3Qge1xuICAgIGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLFxuICAgIHNjaGVtYXRpYzogc2NoZW1hdGljTmFtZSxcbiAgfSA9IHBhcnNlU2NoZW1hdGljTmFtZShhcmd2Ll8uc2hpZnQoKSB8fCBudWxsKTtcbiAgY29uc3QgaXNMb2NhbENvbGxlY3Rpb24gPSBjb2xsZWN0aW9uTmFtZS5zdGFydHNXaXRoKCcuJykgfHwgY29sbGVjdGlvbk5hbWUuc3RhcnRzV2l0aCgnLycpO1xuXG4gIC8qKiBJZiB0aGUgdXNlciB3YW50cyB0byBsaXN0IHNjaGVtYXRpY3MsIHdlIHNpbXBseSBzaG93IGFsbCB0aGUgc2NoZW1hdGljIG5hbWVzLiAqL1xuICBpZiAoYXJndlsnbGlzdC1zY2hlbWF0aWNzJ10pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZW5naW5lSG9zdCA9IG5ldyBOb2RlTW9kdWxlc0VuZ2luZUhvc3QoKTtcbiAgICAgIGNvbnN0IGVuZ2luZSA9IG5ldyBTY2hlbWF0aWNFbmdpbmUoZW5naW5lSG9zdCk7XG4gICAgICBjb25zdCBjb2xsZWN0aW9uID0gZW5naW5lLmNyZWF0ZUNvbGxlY3Rpb24oY29sbGVjdGlvbk5hbWUpO1xuICAgICAgbG9nZ2VyLmluZm8oZW5naW5lLmxpc3RTY2hlbWF0aWNOYW1lcyhjb2xsZWN0aW9uKS5qb2luKCdcXG4nKSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5mYXRhbChlcnJvci5tZXNzYWdlKTtcblxuICAgICAgcmV0dXJuIDE7XG4gICAgfVxuXG4gICAgcmV0dXJuIDA7XG4gIH1cblxuICBpZiAoIXNjaGVtYXRpY05hbWUpIHtcbiAgICBsb2dnZXIuaW5mbyhnZXRVc2FnZSgpKTtcblxuICAgIHJldHVybiAxO1xuICB9XG5cbiAgLyoqIEdhdGhlciB0aGUgYXJndW1lbnRzIGZvciBsYXRlciB1c2UuICovXG4gIGNvbnN0IGRlYnVnOiBib29sZWFuID0gYXJndi5kZWJ1ZyA9PT0gbnVsbCA/IGlzTG9jYWxDb2xsZWN0aW9uIDogYXJndi5kZWJ1ZztcbiAgY29uc3QgZHJ5UnVuOiBib29sZWFuID0gYXJndlsnZHJ5LXJ1biddID09PSBudWxsID8gZGVidWcgOiBhcmd2WydkcnktcnVuJ107XG4gIGNvbnN0IGZvcmNlID0gYXJndlsnZm9yY2UnXTtcbiAgY29uc3QgYWxsb3dQcml2YXRlID0gYXJndlsnYWxsb3ctcHJpdmF0ZSddO1xuXG4gIC8qKiBDcmVhdGUgYSBWaXJ0dWFsIEZTIEhvc3Qgc2NvcGVkIHRvIHdoZXJlIHRoZSBwcm9jZXNzIGlzIGJlaW5nIHJ1bi4gKiovXG4gIGNvbnN0IGZzSG9zdCA9IG5ldyB2aXJ0dWFsRnMuU2NvcGVkSG9zdChuZXcgTm9kZUpzU3luY0hvc3QoKSwgbm9ybWFsaXplKHByb2Nlc3MuY3dkKCkpKTtcblxuICAvKiogQ3JlYXRlIHRoZSB3b3JrZmxvdyB0aGF0IHdpbGwgYmUgZXhlY3V0ZWQgd2l0aCB0aGlzIHJ1bi4gKi9cbiAgY29uc3Qgd29ya2Zsb3cgPSBuZXcgTm9kZVdvcmtmbG93KGZzSG9zdCwgeyBmb3JjZSwgZHJ5UnVuIH0pO1xuXG4gIC8vIEluZGljYXRlIHRvIHRoZSB1c2VyIHdoZW4gbm90aGluZyBoYXMgYmVlbiBkb25lLiBUaGlzIGlzIGF1dG9tYXRpY2FsbHkgc2V0IHRvIG9mZiB3aGVuIHRoZXJlJ3NcbiAgLy8gYSBuZXcgRHJ5UnVuRXZlbnQuXG4gIGxldCBub3RoaW5nRG9uZSA9IHRydWU7XG5cbiAgLy8gTG9nZ2luZyBxdWV1ZSB0aGF0IHJlY2VpdmVzIGFsbCB0aGUgbWVzc2FnZXMgdG8gc2hvdyB0aGUgdXNlcnMuIFRoaXMgb25seSBnZXQgc2hvd24gd2hlbiBub1xuICAvLyBlcnJvcnMgaGFwcGVuZWQuXG4gIGxldCBsb2dnaW5nUXVldWU6IHN0cmluZ1tdID0gW107XG4gIGxldCBlcnJvciA9IGZhbHNlO1xuXG4gIC8qKlxuICAgKiBMb2dzIG91dCBkcnkgcnVuIGV2ZW50cy5cbiAgICpcbiAgICogQWxsIGV2ZW50cyB3aWxsIGFsd2F5cyBiZSBleGVjdXRlZCBoZXJlLCBpbiBvcmRlciBvZiBkaXNjb3ZlcnkuIFRoYXQgbWVhbnMgdGhhdCBhbiBlcnJvciB3b3VsZFxuICAgKiBiZSBzaG93biBhbG9uZyBvdGhlciBldmVudHMgd2hlbiBpdCBoYXBwZW5zLiBTaW5jZSBlcnJvcnMgaW4gd29ya2Zsb3dzIHdpbGwgc3RvcCB0aGUgT2JzZXJ2YWJsZVxuICAgKiBmcm9tIGNvbXBsZXRpbmcgc3VjY2Vzc2Z1bGx5LCB3ZSByZWNvcmQgYW55IGV2ZW50cyBvdGhlciB0aGFuIGVycm9ycywgdGhlbiBvbiBjb21wbGV0aW9uIHdlXG4gICAqIHNob3cgdGhlbS5cbiAgICpcbiAgICogVGhpcyBpcyBhIHNpbXBsZSB3YXkgdG8gb25seSBzaG93IGVycm9ycyB3aGVuIGFuIGVycm9yIG9jY3VyLlxuICAgKi9cbiAgd29ya2Zsb3cucmVwb3J0ZXIuc3Vic2NyaWJlKChldmVudDogRHJ5UnVuRXZlbnQpID0+IHtcbiAgICBub3RoaW5nRG9uZSA9IGZhbHNlO1xuXG4gICAgc3dpdGNoIChldmVudC5raW5kKSB7XG4gICAgICBjYXNlICdlcnJvcic6XG4gICAgICAgIGVycm9yID0gdHJ1ZTtcblxuICAgICAgICBjb25zdCBkZXNjID0gZXZlbnQuZGVzY3JpcHRpb24gPT0gJ2FscmVhZHlFeGlzdCcgPyAnYWxyZWFkeSBleGlzdHMnIDogJ2RvZXMgbm90IGV4aXN0JztcbiAgICAgICAgbG9nZ2VyLndhcm4oYEVSUk9SISAke2V2ZW50LnBhdGh9ICR7ZGVzY30uYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndXBkYXRlJzpcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2godGFncy5vbmVMaW5lYFxuICAgICAgICAke3Rlcm1pbmFsLndoaXRlKCdVUERBVEUnKX0gJHtldmVudC5wYXRofSAoJHtldmVudC5jb250ZW50Lmxlbmd0aH0gYnl0ZXMpXG4gICAgICBgKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdjcmVhdGUnOlxuICAgICAgICBsb2dnaW5nUXVldWUucHVzaCh0YWdzLm9uZUxpbmVgXG4gICAgICAgICR7dGVybWluYWwuZ3JlZW4oJ0NSRUFURScpfSAke2V2ZW50LnBhdGh9ICgke2V2ZW50LmNvbnRlbnQubGVuZ3RofSBieXRlcylcbiAgICAgIGApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2RlbGV0ZSc6XG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke3Rlcm1pbmFsLnllbGxvdygnREVMRVRFJyl9ICR7ZXZlbnQucGF0aH1gKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdyZW5hbWUnOlxuICAgICAgICBsb2dnaW5nUXVldWUucHVzaChgJHt0ZXJtaW5hbC5ibHVlKCdSRU5BTUUnKX0gJHtldmVudC5wYXRofSA9PiAke2V2ZW50LnRvfWApO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqIExpc3RlbiB0byBsaWZlY3ljbGUgZXZlbnRzIG9mIHRoZSB3b3JrZmxvdyB0byBmbHVzaCB0aGUgbG9ncyBiZXR3ZWVuIGVhY2ggcGhhc2VzLlxuICAgKi9cbiAgd29ya2Zsb3cubGlmZUN5Y2xlLnN1YnNjcmliZShldmVudCA9PiB7XG4gICAgaWYgKGV2ZW50LmtpbmQgPT0gJ3dvcmtmbG93LWVuZCcgfHwgZXZlbnQua2luZCA9PSAncG9zdC10YXNrcy1zdGFydCcpIHtcbiAgICAgIGlmICghZXJyb3IpIHtcbiAgICAgICAgLy8gRmx1c2ggdGhlIGxvZyBxdWV1ZSBhbmQgY2xlYW4gdGhlIGVycm9yIHN0YXRlLlxuICAgICAgICBsb2dnaW5nUXVldWUuZm9yRWFjaChsb2cgPT4gbG9nZ2VyLmluZm8obG9nKSk7XG4gICAgICB9XG5cbiAgICAgIGxvZ2dpbmdRdWV1ZSA9IFtdO1xuICAgICAgZXJyb3IgPSBmYWxzZTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqIFJlbW92ZSBldmVyeSBvcHRpb25zIGZyb20gYXJndiB0aGF0IHdlIHN1cHBvcnQgaW4gc2NoZW1hdGljcyBpdHNlbGYuXG4gICAqL1xuICBjb25zdCBwYXJzZWRBcmdzID0gT2JqZWN0LmFzc2lnbih7fSwgYXJndik7XG4gIGRlbGV0ZSBwYXJzZWRBcmdzWyctLSddO1xuICBmb3IgKGNvbnN0IGtleSBvZiBib29sZWFuQXJncykge1xuICAgIGRlbGV0ZSBwYXJzZWRBcmdzW2tleV07XG4gIH1cblxuICAvKipcbiAgICogQWRkIG9wdGlvbnMgZnJvbSBgLS1gIHRvIGFyZ3MuXG4gICAqL1xuICBjb25zdCBhcmd2MiA9IG1pbmltaXN0KGFyZ3ZbJy0tJ10pO1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhhcmd2MikpIHtcbiAgICBwYXJzZWRBcmdzW2tleV0gPSBhcmd2MltrZXldO1xuICB9XG5cbiAgLy8gUGFzcyB0aGUgcmVzdCBvZiB0aGUgYXJndW1lbnRzIGFzIHRoZSBzbWFydCBkZWZhdWx0IFwiYXJndlwiLiBUaGVuIGRlbGV0ZSBpdC5cbiAgd29ya2Zsb3cucmVnaXN0cnkuYWRkU21hcnREZWZhdWx0UHJvdmlkZXIoJ2FyZ3YnLCAoc2NoZW1hOiBKc29uT2JqZWN0KSA9PiB7XG4gICAgaWYgKCdpbmRleCcgaW4gc2NoZW1hKSB7XG4gICAgICByZXR1cm4gYXJndi5fW051bWJlcihzY2hlbWFbJ2luZGV4J10pXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGFyZ3YuXztcbiAgICB9XG4gIH0pO1xuICBkZWxldGUgcGFyc2VkQXJncy5fO1xuXG5cbiAgLyoqXG4gICAqICBFeGVjdXRlIHRoZSB3b3JrZmxvdywgd2hpY2ggd2lsbCByZXBvcnQgdGhlIGRyeSBydW4gZXZlbnRzLCBydW4gdGhlIHRhc2tzLCBhbmQgY29tcGxldGVcbiAgICogIGFmdGVyIGFsbCBpcyBkb25lLlxuICAgKlxuICAgKiAgVGhlIE9ic2VydmFibGUgcmV0dXJuZWQgd2lsbCBwcm9wZXJseSBjYW5jZWwgdGhlIHdvcmtmbG93IGlmIHVuc3Vic2NyaWJlZCwgZXJyb3Igb3V0IGlmIEFOWVxuICAgKiAgc3RlcCBvZiB0aGUgd29ya2Zsb3cgZmFpbGVkIChzaW5rIG9yIHRhc2spLCB3aXRoIGRldGFpbHMgaW5jbHVkZWQsIGFuZCB3aWxsIG9ubHkgY29tcGxldGVcbiAgICogIHdoZW4gZXZlcnl0aGluZyBpcyBkb25lLlxuICAgKi9cbiAgdHJ5IHtcbiAgICBhd2FpdCB3b3JrZmxvdy5leGVjdXRlKHtcbiAgICAgIGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLFxuICAgICAgc2NoZW1hdGljOiBzY2hlbWF0aWNOYW1lLFxuICAgICAgb3B0aW9uczogcGFyc2VkQXJncyxcbiAgICAgIGFsbG93UHJpdmF0ZTogYWxsb3dQcml2YXRlLFxuICAgICAgZGVidWc6IGRlYnVnLFxuICAgICAgbG9nZ2VyOiBsb2dnZXIsXG4gICAgfSlcbiAgICAgIC50b1Byb21pc2UoKTtcblxuICAgIGlmIChub3RoaW5nRG9uZSkge1xuICAgICAgbG9nZ2VyLmluZm8oJ05vdGhpbmcgdG8gYmUgZG9uZS4nKTtcbiAgICB9XG5cbiAgICByZXR1cm4gMDtcblxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBpZiAoZXJyIGluc3RhbmNlb2YgVW5zdWNjZXNzZnVsV29ya2Zsb3dFeGVjdXRpb24pIHtcbiAgICAgIC8vIFwiU2VlIGFib3ZlXCIgYmVjYXVzZSB3ZSBhbHJlYWR5IHByaW50ZWQgdGhlIGVycm9yLlxuICAgICAgbG9nZ2VyLmZhdGFsKCdUaGUgU2NoZW1hdGljIHdvcmtmbG93IGZhaWxlZC4gU2VlIGFib3ZlLicpO1xuICAgIH0gZWxzZSBpZiAoZGVidWcpIHtcbiAgICAgIGxvZ2dlci5mYXRhbCgnQW4gZXJyb3Igb2NjdXJlZDpcXG4nICsgZXJyLnN0YWNrKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbG9nZ2VyLmZhdGFsKGVyci5zdGFjayB8fCBlcnIubWVzc2FnZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIDE7XG4gIH1cbn1cblxuIC8qKlxuICogR2V0IHVzYWdlIG9mIHRoZSBDTEkgdG9vbC5cbiAqL1xuZnVuY3Rpb24gZ2V0VXNhZ2UoKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRhZ3Muc3RyaXBJbmRlbnRgXG4gIHNjaGVtYXRpY3MgW0NvbGxlY3Rpb25OYW1lOl1TY2hlbWF0aWNOYW1lIFtvcHRpb25zLCAuLi5dXG5cbiAgQnkgZGVmYXVsdCwgaWYgdGhlIGNvbGxlY3Rpb24gbmFtZSBpcyBub3Qgc3BlY2lmaWVkLCB1c2UgdGhlIGludGVybmFsIGNvbGxlY3Rpb24gcHJvdmlkZWRcbiAgYnkgdGhlIFNjaGVtYXRpY3MgQ0xJLlxuXG4gIE9wdGlvbnM6XG4gICAgICAtLWRlYnVnICAgICAgICAgICAgIERlYnVnIG1vZGUuIFRoaXMgaXMgdHJ1ZSBieSBkZWZhdWx0IGlmIHRoZSBjb2xsZWN0aW9uIGlzIGEgcmVsYXRpdmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aCAoaW4gdGhhdCBjYXNlLCB0dXJuIG9mZiB3aXRoIC0tZGVidWc9ZmFsc2UpLlxuXG4gICAgICAtLWFsbG93LXByaXZhdGUgICAgIEFsbG93IHByaXZhdGUgc2NoZW1hdGljcyB0byBiZSBydW4gZnJvbSB0aGUgY29tbWFuZCBsaW5lLiBEZWZhdWx0IHRvXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGZhbHNlLlxuXG4gICAgICAtLWRyeS1ydW4gICAgICAgICAgIERvIG5vdCBvdXRwdXQgYW55dGhpbmcsIGJ1dCBpbnN0ZWFkIGp1c3Qgc2hvdyB3aGF0IGFjdGlvbnMgd291bGQgYmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcGVyZm9ybWVkLiBEZWZhdWx0IHRvIHRydWUgaWYgZGVidWcgaXMgYWxzbyB0cnVlLlxuXG4gICAgICAtLWZvcmNlICAgICAgICAgICAgIEZvcmNlIG92ZXJ3cml0aW5nIGZpbGVzIHRoYXQgd291bGQgb3RoZXJ3aXNlIGJlIGFuIGVycm9yLlxuXG4gICAgICAtLWxpc3Qtc2NoZW1hdGljcyAgIExpc3QgYWxsIHNjaGVtYXRpY3MgZnJvbSB0aGUgY29sbGVjdGlvbiwgYnkgbmFtZS4gQSBjb2xsZWN0aW9uIG5hbWVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc2hvdWxkIGJlIHN1ZmZpeGVkIGJ5IGEgY29sb24uIEV4YW1wbGU6ICdAc2NoZW1hdGljcy9zY2hlbWF0aWNzOicuXG5cbiAgICAgIC0tdmVyYm9zZSAgICAgICAgICAgU2hvdyBtb3JlIGluZm9ybWF0aW9uLlxuXG4gICAgICAtLWhlbHAgICAgICAgICAgICAgIFNob3cgdGhpcyBtZXNzYWdlLlxuXG4gIEFueSBhZGRpdGlvbmFsIG9wdGlvbiBpcyBwYXNzZWQgdG8gdGhlIFNjaGVtYXRpY3MgZGVwZW5kaW5nIG9uXG4gIGA7XG59XG5cbi8qKiBQYXJzZSB0aGUgY29tbWFuZCBsaW5lLiAqL1xuY29uc3QgYm9vbGVhbkFyZ3MgPSBbXG4gICdhbGxvd1ByaXZhdGUnLFxuICAnYWxsb3ctcHJpdmF0ZScsXG4gICdkZWJ1ZycsXG4gICdkcnktcnVuJyxcbiAgJ2RyeVJ1bicsXG4gICdmb3JjZScsXG4gICdoZWxwJyxcbiAgJ2xpc3Qtc2NoZW1hdGljcycsXG4gICdsaXN0U2NoZW1hdGljcycsXG4gICd2ZXJib3NlJyxcbl07XG5cbmZ1bmN0aW9uIHBhcnNlQXJncyhhcmdzOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCk6IG1pbmltaXN0LlBhcnNlZEFyZ3Mge1xuICAgIHJldHVybiBtaW5pbWlzdChhcmdzLCB7XG4gICAgICBib29sZWFuOiBib29sZWFuQXJncyxcbiAgICAgIGFsaWFzOiB7XG4gICAgICAgICdkcnlSdW4nOiAnZHJ5LXJ1bicsXG4gICAgICAgICdsaXN0U2NoZW1hdGljcyc6ICdsaXN0LXNjaGVtYXRpY3MnLFxuICAgICAgICAnYWxsb3dQcml2YXRlJzogJ2FsbG93LXByaXZhdGUnLFxuICAgICAgfSxcbiAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgJ2RlYnVnJzogbnVsbCxcbiAgICAgICAgJ2RyeS1ydW4nOiBudWxsLFxuICAgICAgfSxcbiAgICAgICctLSc6IHRydWUsXG4gICAgfSk7XG59XG5cbmlmIChyZXF1aXJlLm1haW4gPT09IG1vZHVsZSkge1xuICBjb25zdCBhcmdzID0gcHJvY2Vzcy5hcmd2LnNsaWNlKDIpO1xuICBtYWluKHsgYXJncyB9KVxuICAgIC50aGVuKGV4aXRDb2RlID0+IHByb2Nlc3MuZXhpdENvZGUgPSBleGl0Q29kZSlcbiAgICAuY2F0Y2goZSA9PiB7IHRocm93IChlKTsgfSk7XG59XG4iXX0=