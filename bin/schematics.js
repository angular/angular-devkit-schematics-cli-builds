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
            'dryRun': null,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIuLyIsInNvdXJjZXMiOlsicGFja2FnZXMvYW5ndWxhcl9kZXZraXQvc2NoZW1hdGljc19jbGkvYmluL3NjaGVtYXRpY3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBU0EsNkJBQTJCO0FBQzNCLGdDQUFnQztBQUNoQyx5REFBeUQ7QUFDekQsK0NBTThCO0FBQzlCLG9EQUErRjtBQUMvRiwyREFJb0M7QUFDcEMsNERBQXVGO0FBQ3ZGLHFDQUFxQztBQUdyQzs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxHQUFrQjtJQUM1QyxJQUFJLFVBQVUsR0FBRyx3QkFBd0IsQ0FBQztJQUUxQyxJQUFJLFNBQVMsR0FBRyxHQUFHLENBQUM7SUFDcEIsSUFBSSxTQUFTLElBQUksU0FBUyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsRUFBRTtRQUM3QyxDQUFDLFVBQVUsRUFBRSxTQUFTLENBQUMsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQztLQUNuRDtJQUVELE9BQU8sRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFDbkMsQ0FBQztBQVNNLEtBQUssVUFBVSxJQUFJLENBQUMsRUFDekIsSUFBSSxFQUNKLE1BQU0sR0FBRyxPQUFPLENBQUMsTUFBTSxFQUN2QixNQUFNLEdBQUcsT0FBTyxDQUFDLE1BQU0sR0FDWDtJQUVaLE1BQU0sSUFBSSxHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUU3QixxREFBcUQ7SUFDckQsTUFBTSxNQUFNLEdBQUcsMEJBQW1CLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztJQUNwRSxJQUFJLElBQUksQ0FBQyxJQUFJLEVBQUU7UUFDYixNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFF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WUFDbkMsY0FBYyxFQUFFLGVBQWU7U0FDaEM7UUFDRCxPQUFPLEVBQUU7WUFDUCxPQUFPLEVBQUUsSUFBSTtZQUNiLFFBQVEsRUFBRSxJQUFJO1NBQ2Y7UUFDRCxJQUFJLEVBQUUsSUFBSTtLQUNYLENBQUMsQ0FBQztBQUNQLENBQUM7QUFFRCxJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssTUFBTSxFQUFFO0lBQzNCLE1BQU0sSUFBSSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ25DLElBQUksQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDO1NBQ1gsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsT0FBTyxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7U0FDN0MsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDL0IiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG4vKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCAnc3ltYm9sLW9ic2VydmFibGUnO1xuLy8gc3ltYm9sIHBvbHlmaWxsIG11c3QgZ28gZmlyc3Rcbi8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpvcmRlcmVkLWltcG9ydHMgaW1wb3J0LWdyb3Vwc1xuaW1wb3J0IHtcbiAgSnNvbk9iamVjdCxcbiAgbm9ybWFsaXplLFxuICB0YWdzLFxuICB0ZXJtaW5hbCxcbiAgdmlydHVhbEZzLFxufSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZSc7XG5pbXBvcnQgeyBOb2RlSnNTeW5jSG9zdCwgUHJvY2Vzc091dHB1dCwgY3JlYXRlQ29uc29sZUxvZ2dlciB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlL25vZGUnO1xuaW1wb3J0IHtcbiAgRHJ5UnVuRXZlbnQsXG4gIFNjaGVtYXRpY0VuZ2luZSxcbiAgVW5zdWNjZXNzZnVsV29ya2Zsb3dFeGVjdXRpb24sXG59IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzJztcbmltcG9ydCB7IE5vZGVNb2R1bGVzRW5naW5lSG9zdCwgTm9kZVdvcmtmbG93IH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MvdG9vbHMnO1xuaW1wb3J0ICogYXMgbWluaW1pc3QgZnJvbSAnbWluaW1pc3QnO1xuXG5cbi8qKlxuICogUGFyc2UgdGhlIG5hbWUgb2Ygc2NoZW1hdGljIHBhc3NlZCBpbiBhcmd1bWVudCwgYW5kIHJldHVybiBhIHtjb2xsZWN0aW9uLCBzY2hlbWF0aWN9IG5hbWVkXG4gKiB0dXBsZS4gVGhlIHVzZXIgY2FuIHBhc3MgaW4gYGNvbGxlY3Rpb24tbmFtZTpzY2hlbWF0aWMtbmFtZWAsIGFuZCB0aGlzIGZ1bmN0aW9uIHdpbGwgZWl0aGVyXG4gKiByZXR1cm4gYHtjb2xsZWN0aW9uOiAnY29sbGVjdGlvbi1uYW1lJywgc2NoZW1hdGljOiAnc2NoZW1hdGljLW5hbWUnfWAsIG9yIGl0IHdpbGwgZXJyb3Igb3V0XG4gKiBhbmQgc2hvdyB1c2FnZS5cbiAqXG4gKiBJbiB0aGUgY2FzZSB3aGVyZSBhIGNvbGxlY3Rpb24gbmFtZSBpc24ndCBwYXJ0IG9mIHRoZSBhcmd1bWVudCwgdGhlIGRlZmF1bHQgaXMgdG8gdXNlIHRoZVxuICogc2NoZW1hdGljcyBwYWNrYWdlIChAc2NoZW1hdGljcy9zY2hlbWF0aWNzKSBhcyB0aGUgY29sbGVjdGlvbi5cbiAqXG4gKiBUaGlzIGxvZ2ljIGlzIGVudGlyZWx5IHVwIHRvIHRoZSB0b29saW5nLlxuICpcbiAqIEBwYXJhbSBzdHIgVGhlIGFyZ3VtZW50IHRvIHBhcnNlLlxuICogQHJldHVybiB7e2NvbGxlY3Rpb246IHN0cmluZywgc2NoZW1hdGljOiAoc3RyaW5nKX19XG4gKi9cbmZ1bmN0aW9uIHBhcnNlU2NoZW1hdGljTmFtZShzdHI6IHN0cmluZyB8IG51bGwpOiB7IGNvbGxlY3Rpb246IHN0cmluZywgc2NoZW1hdGljOiBzdHJpbmcgfCBudWxsIH0ge1xuICBsZXQgY29sbGVjdGlvbiA9ICdAc2NoZW1hdGljcy9zY2hlbWF0aWNzJztcblxuICBsZXQgc2NoZW1hdGljID0gc3RyO1xuICBpZiAoc2NoZW1hdGljICYmIHNjaGVtYXRpYy5pbmRleE9mKCc6JykgIT0gLTEpIHtcbiAgICBbY29sbGVjdGlvbiwgc2NoZW1hdGljXSA9IHNjaGVtYXRpYy5zcGxpdCgnOicsIDIpO1xuICB9XG5cbiAgcmV0dXJuIHsgY29sbGVjdGlvbiwgc2NoZW1hdGljIH07XG59XG5cblxuZXhwb3J0IGludGVyZmFjZSBNYWluT3B0aW9ucyB7XG4gIGFyZ3M6IHN0cmluZ1tdO1xuICBzdGRvdXQ/OiBQcm9jZXNzT3V0cHV0O1xuICBzdGRlcnI/OiBQcm9jZXNzT3V0cHV0O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWFpbih7XG4gIGFyZ3MsXG4gIHN0ZG91dCA9IHByb2Nlc3Muc3Rkb3V0LFxuICBzdGRlcnIgPSBwcm9jZXNzLnN0ZGVycixcbn06IE1haW5PcHRpb25zKTogUHJvbWlzZTwwIHwgMT4ge1xuXG4gIGNvbnN0IGFyZ3YgPSBwYXJzZUFyZ3MoYXJncyk7XG5cbiAgLyoqIENyZWF0ZSB0aGUgRGV2S2l0IExvZ2dlciB1c2VkIHRocm91Z2ggdGhlIENMSS4gKi9cbiAgY29uc3QgbG9nZ2VyID0gY3JlYXRlQ29uc29sZUxvZ2dlcihhcmd2Wyd2ZXJib3NlJ10sIHN0ZG91dCwgc3RkZXJyKTtcbiAgaWYgKGFyZ3YuaGVscCkge1xuICAgIGxvZ2dlci5pbmZvKGdldFVzYWdlKCkpO1xuXG4gICAgcmV0dXJuIDA7XG4gIH1cblxuICAvKiogR2V0IHRoZSBjb2xsZWN0aW9uIGFuIHNjaGVtYXRpYyBuYW1lIGZyb20gdGhlIGZpcnN0IGFyZ3VtZW50LiAqL1xuICBjb25zdCB7XG4gICAgY29sbGVjdGlvbjogY29sbGVjdGlvbk5hbWUsXG4gICAgc2NoZW1hdGljOiBzY2hlbWF0aWNOYW1lLFxuICB9ID0gcGFyc2VTY2hlbWF0aWNOYW1lKGFyZ3YuXy5zaGlmdCgpIHx8IG51bGwpO1xuICBjb25zdCBpc0xvY2FsQ29sbGVjdGlvbiA9IGNvbGxlY3Rpb25OYW1lLnN0YXJ0c1dpdGgoJy4nKSB8fCBjb2xsZWN0aW9uTmFtZS5zdGFydHNXaXRoKCcvJyk7XG5cbiAgLyoqIElmIHRoZSB1c2VyIHdhbnRzIHRvIGxpc3Qgc2NoZW1hdGljcywgd2Ugc2ltcGx5IHNob3cgYWxsIHRoZSBzY2hlbWF0aWMgbmFtZXMuICovXG4gIGlmIChhcmd2WydsaXN0LXNjaGVtYXRpY3MnXSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBlbmdpbmVIb3N0ID0gbmV3IE5vZGVNb2R1bGVzRW5naW5lSG9zdCgpO1xuICAgICAgY29uc3QgZW5naW5lID0gbmV3IFNjaGVtYXRpY0VuZ2luZShlbmdpbmVIb3N0KTtcbiAgICAgIGNvbnN0IGNvbGxlY3Rpb24gPSBlbmdpbmUuY3JlYXRlQ29sbGVjdGlvbihjb2xsZWN0aW9uTmFtZSk7XG4gICAgICBsb2dnZXIuaW5mbyhlbmdpbmUubGlzdFNjaGVtYXRpY05hbWVzKGNvbGxlY3Rpb24pLmpvaW4oJ1xcbicpKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmZhdGFsKGVycm9yLm1lc3NhZ2UpO1xuXG4gICAgICByZXR1cm4gMTtcbiAgICB9XG5cbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIGlmICghc2NoZW1hdGljTmFtZSkge1xuICAgIGxvZ2dlci5pbmZvKGdldFVzYWdlKCkpO1xuXG4gICAgcmV0dXJuIDE7XG4gIH1cblxuICAvKiogR2F0aGVyIHRoZSBhcmd1bWVudHMgZm9yIGxhdGVyIHVzZS4gKi9cbiAgY29uc3QgZGVidWc6IGJvb2xlYW4gPSBhcmd2LmRlYnVnID09PSBudWxsID8gaXNMb2NhbENvbGxlY3Rpb24gOiBhcmd2LmRlYnVnO1xuICBjb25zdCBkcnlSdW46IGJvb2xlYW4gPSBhcmd2WydkcnktcnVuJ10gPT09IG51bGwgPyBkZWJ1ZyA6IGFyZ3ZbJ2RyeS1ydW4nXTtcbiAgY29uc3QgZm9yY2UgPSBhcmd2Wydmb3JjZSddO1xuICBjb25zdCBhbGxvd1ByaXZhdGUgPSBhcmd2WydhbGxvdy1wcml2YXRlJ107XG5cbiAgLyoqIENyZWF0ZSBhIFZpcnR1YWwgRlMgSG9zdCBzY29wZWQgdG8gd2hlcmUgdGhlIHByb2Nlc3MgaXMgYmVpbmcgcnVuLiAqKi9cbiAgY29uc3QgZnNIb3N0ID0gbmV3IHZpcnR1YWxGcy5TY29wZWRIb3N0KG5ldyBOb2RlSnNTeW5jSG9zdCgpLCBub3JtYWxpemUocHJvY2Vzcy5jd2QoKSkpO1xuXG4gIC8qKiBDcmVhdGUgdGhlIHdvcmtmbG93IHRoYXQgd2lsbCBiZSBleGVjdXRlZCB3aXRoIHRoaXMgcnVuLiAqL1xuICBjb25zdCB3b3JrZmxvdyA9IG5ldyBOb2RlV29ya2Zsb3coZnNIb3N0LCB7IGZvcmNlLCBkcnlSdW4gfSk7XG5cbiAgLy8gSW5kaWNhdGUgdG8gdGhlIHVzZXIgd2hlbiBub3RoaW5nIGhhcyBiZWVuIGRvbmUuIFRoaXMgaXMgYXV0b21hdGljYWxseSBzZXQgdG8gb2ZmIHdoZW4gdGhlcmUnc1xuICAvLyBhIG5ldyBEcnlSdW5FdmVudC5cbiAgbGV0IG5vdGhpbmdEb25lID0gdHJ1ZTtcblxuICAvLyBMb2dnaW5nIHF1ZXVlIHRoYXQgcmVjZWl2ZXMgYWxsIHRoZSBtZXNzYWdlcyB0byBzaG93IHRoZSB1c2Vycy4gVGhpcyBvbmx5IGdldCBzaG93biB3aGVuIG5vXG4gIC8vIGVycm9ycyBoYXBwZW5lZC5cbiAgbGV0IGxvZ2dpbmdRdWV1ZTogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGVycm9yID0gZmFsc2U7XG5cbiAgLyoqXG4gICAqIExvZ3Mgb3V0IGRyeSBydW4gZXZlbnRzLlxuICAgKlxuICAgKiBBbGwgZXZlbnRzIHdpbGwgYWx3YXlzIGJlIGV4ZWN1dGVkIGhlcmUsIGluIG9yZGVyIG9mIGRpc2NvdmVyeS4gVGhhdCBtZWFucyB0aGF0IGFuIGVycm9yIHdvdWxkXG4gICAqIGJlIHNob3duIGFsb25nIG90aGVyIGV2ZW50cyB3aGVuIGl0IGhhcHBlbnMuIFNpbmNlIGVycm9ycyBpbiB3b3JrZmxvd3Mgd2lsbCBzdG9wIHRoZSBPYnNlcnZhYmxlXG4gICAqIGZyb20gY29tcGxldGluZyBzdWNjZXNzZnVsbHksIHdlIHJlY29yZCBhbnkgZXZlbnRzIG90aGVyIHRoYW4gZXJyb3JzLCB0aGVuIG9uIGNvbXBsZXRpb24gd2VcbiAgICogc2hvdyB0aGVtLlxuICAgKlxuICAgKiBUaGlzIGlzIGEgc2ltcGxlIHdheSB0byBvbmx5IHNob3cgZXJyb3JzIHdoZW4gYW4gZXJyb3Igb2NjdXIuXG4gICAqL1xuICB3b3JrZmxvdy5yZXBvcnRlci5zdWJzY3JpYmUoKGV2ZW50OiBEcnlSdW5FdmVudCkgPT4ge1xuICAgIG5vdGhpbmdEb25lID0gZmFsc2U7XG5cbiAgICBzd2l0Y2ggKGV2ZW50LmtpbmQpIHtcbiAgICAgIGNhc2UgJ2Vycm9yJzpcbiAgICAgICAgZXJyb3IgPSB0cnVlO1xuXG4gICAgICAgIGNvbnN0IGRlc2MgPSBldmVudC5kZXNjcmlwdGlvbiA9PSAnYWxyZWFkeUV4aXN0JyA/ICdhbHJlYWR5IGV4aXN0cycgOiAnZG9lcyBub3QgZXhpc3QnO1xuICAgICAgICBsb2dnZXIud2FybihgRVJST1IhICR7ZXZlbnQucGF0aH0gJHtkZXNjfS5gKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd1cGRhdGUnOlxuICAgICAgICBsb2dnaW5nUXVldWUucHVzaCh0YWdzLm9uZUxpbmVgXG4gICAgICAgICR7dGVybWluYWwud2hpdGUoJ1VQREFURScpfSAke2V2ZW50LnBhdGh9ICgke2V2ZW50LmNvbnRlbnQubGVuZ3RofSBieXRlcylcbiAgICAgIGApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKHRhZ3Mub25lTGluZWBcbiAgICAgICAgJHt0ZXJtaW5hbC5ncmVlbignQ1JFQVRFJyl9ICR7ZXZlbnQucGF0aH0gKCR7ZXZlbnQuY29udGVudC5sZW5ndGh9IGJ5dGVzKVxuICAgICAgYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7dGVybWluYWwueWVsbG93KCdERUxFVEUnKX0gJHtldmVudC5wYXRofWApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3JlbmFtZSc6XG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKGAke3Rlcm1pbmFsLmJsdWUoJ1JFTkFNRScpfSAke2V2ZW50LnBhdGh9ID0+ICR7ZXZlbnQudG99YCk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogTGlzdGVuIHRvIGxpZmVjeWNsZSBldmVudHMgb2YgdGhlIHdvcmtmbG93IHRvIGZsdXNoIHRoZSBsb2dzIGJldHdlZW4gZWFjaCBwaGFzZXMuXG4gICAqL1xuICB3b3JrZmxvdy5saWZlQ3ljbGUuc3Vic2NyaWJlKGV2ZW50ID0+IHtcbiAgICBpZiAoZXZlbnQua2luZCA9PSAnd29ya2Zsb3ctZW5kJyB8fCBldmVudC5raW5kID09ICdwb3N0LXRhc2tzLXN0YXJ0Jykge1xuICAgICAgaWYgKCFlcnJvcikge1xuICAgICAgICAvLyBGbHVzaCB0aGUgbG9nIHF1ZXVlIGFuZCBjbGVhbiB0aGUgZXJyb3Igc3RhdGUuXG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5mb3JFYWNoKGxvZyA9PiBsb2dnZXIuaW5mbyhsb2cpKTtcbiAgICAgIH1cblxuICAgICAgbG9nZ2luZ1F1ZXVlID0gW107XG4gICAgICBlcnJvciA9IGZhbHNlO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogUmVtb3ZlIGV2ZXJ5IG9wdGlvbnMgZnJvbSBhcmd2IHRoYXQgd2Ugc3VwcG9ydCBpbiBzY2hlbWF0aWNzIGl0c2VsZi5cbiAgICovXG4gIGNvbnN0IHBhcnNlZEFyZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBhcmd2KTtcbiAgZGVsZXRlIHBhcnNlZEFyZ3NbJy0tJ107XG4gIGZvciAoY29uc3Qga2V5IG9mIGJvb2xlYW5BcmdzKSB7XG4gICAgZGVsZXRlIHBhcnNlZEFyZ3Nba2V5XTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgb3B0aW9ucyBmcm9tIGAtLWAgdG8gYXJncy5cbiAgICovXG4gIGNvbnN0IGFyZ3YyID0gbWluaW1pc3QoYXJndlsnLS0nXSk7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGFyZ3YyKSkge1xuICAgIHBhcnNlZEFyZ3Nba2V5XSA9IGFyZ3YyW2tleV07XG4gIH1cblxuICAvLyBQYXNzIHRoZSByZXN0IG9mIHRoZSBhcmd1bWVudHMgYXMgdGhlIHNtYXJ0IGRlZmF1bHQgXCJhcmd2XCIuIFRoZW4gZGVsZXRlIGl0LlxuICB3b3JrZmxvdy5yZWdpc3RyeS5hZGRTbWFydERlZmF1bHRQcm92aWRlcignYXJndicsIChzY2hlbWE6IEpzb25PYmplY3QpID0+IHtcbiAgICBpZiAoJ2luZGV4JyBpbiBzY2hlbWEpIHtcbiAgICAgIHJldHVybiBhcmd2Ll9bTnVtYmVyKHNjaGVtYVsnaW5kZXgnXSldO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gYXJndi5fO1xuICAgIH1cbiAgfSk7XG4gIGRlbGV0ZSBwYXJzZWRBcmdzLl87XG5cblxuICAvKipcbiAgICogIEV4ZWN1dGUgdGhlIHdvcmtmbG93LCB3aGljaCB3aWxsIHJlcG9ydCB0aGUgZHJ5IHJ1biBldmVudHMsIHJ1biB0aGUgdGFza3MsIGFuZCBjb21wbGV0ZVxuICAgKiAgYWZ0ZXIgYWxsIGlzIGRvbmUuXG4gICAqXG4gICAqICBUaGUgT2JzZXJ2YWJsZSByZXR1cm5lZCB3aWxsIHByb3Blcmx5IGNhbmNlbCB0aGUgd29ya2Zsb3cgaWYgdW5zdWJzY3JpYmVkLCBlcnJvciBvdXQgaWYgQU5ZXG4gICAqICBzdGVwIG9mIHRoZSB3b3JrZmxvdyBmYWlsZWQgKHNpbmsgb3IgdGFzayksIHdpdGggZGV0YWlscyBpbmNsdWRlZCwgYW5kIHdpbGwgb25seSBjb21wbGV0ZVxuICAgKiAgd2hlbiBldmVyeXRoaW5nIGlzIGRvbmUuXG4gICAqL1xuICB0cnkge1xuICAgIGF3YWl0IHdvcmtmbG93LmV4ZWN1dGUoe1xuICAgICAgY29sbGVjdGlvbjogY29sbGVjdGlvbk5hbWUsXG4gICAgICBzY2hlbWF0aWM6IHNjaGVtYXRpY05hbWUsXG4gICAgICBvcHRpb25zOiBwYXJzZWRBcmdzLFxuICAgICAgYWxsb3dQcml2YXRlOiBhbGxvd1ByaXZhdGUsXG4gICAgICBkZWJ1ZzogZGVidWcsXG4gICAgICBsb2dnZXI6IGxvZ2dlcixcbiAgICB9KVxuICAgICAgLnRvUHJvbWlzZSgpO1xuXG4gICAgaWYgKG5vdGhpbmdEb25lKSB7XG4gICAgICBsb2dnZXIuaW5mbygnTm90aGluZyB0byBiZSBkb25lLicpO1xuICAgIH1cblxuICAgIHJldHVybiAwO1xuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBVbnN1Y2Nlc3NmdWxXb3JrZmxvd0V4ZWN1dGlvbikge1xuICAgICAgLy8gXCJTZWUgYWJvdmVcIiBiZWNhdXNlIHdlIGFscmVhZHkgcHJpbnRlZCB0aGUgZXJyb3IuXG4gICAgICBsb2dnZXIuZmF0YWwoJ1RoZSBTY2hlbWF0aWMgd29ya2Zsb3cgZmFpbGVkLiBTZWUgYWJvdmUuJyk7XG4gICAgfSBlbHNlIGlmIChkZWJ1Zykge1xuICAgICAgbG9nZ2VyLmZhdGFsKCdBbiBlcnJvciBvY2N1cmVkOlxcbicgKyBlcnIuc3RhY2spO1xuICAgIH0gZWxzZSB7XG4gICAgICBsb2dnZXIuZmF0YWwoZXJyLnN0YWNrIHx8IGVyci5tZXNzYWdlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gMTtcbiAgfVxufVxuXG4gLyoqXG4gKiBHZXQgdXNhZ2Ugb2YgdGhlIENMSSB0b29sLlxuICovXG5mdW5jdGlvbiBnZXRVc2FnZSgpOiBzdHJpbmcge1xuICByZXR1cm4gdGFncy5zdHJpcEluZGVudGBcbiAgc2NoZW1hdGljcyBbQ29sbGVjdGlvbk5hbWU6XVNjaGVtYXRpY05hbWUgW29wdGlvbnMsIC4uLl1cblxuICBCeSBkZWZhdWx0LCBpZiB0aGUgY29sbGVjdGlvbiBuYW1lIGlzIG5vdCBzcGVjaWZpZWQsIHVzZSB0aGUgaW50ZXJuYWwgY29sbGVjdGlvbiBwcm92aWRlZFxuICBieSB0aGUgU2NoZW1hdGljcyBDTEkuXG5cbiAgT3B0aW9uczpcbiAgICAgIC0tZGVidWcgICAgICAgICAgICAgRGVidWcgbW9kZS4gVGhpcyBpcyB0cnVlIGJ5IGRlZmF1bHQgaWYgdGhlIGNvbGxlY3Rpb24gaXMgYSByZWxhdGl2ZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoIChpbiB0aGF0IGNhc2UsIHR1cm4gb2ZmIHdpdGggLS1kZWJ1Zz1mYWxzZSkuXG5cbiAgICAgIC0tYWxsb3ctcHJpdmF0ZSAgICAgQWxsb3cgcHJpdmF0ZSBzY2hlbWF0aWNzIHRvIGJlIHJ1biBmcm9tIHRoZSBjb21tYW5kIGxpbmUuIERlZmF1bHQgdG9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgZmFsc2UuXG5cbiAgICAgIC0tZHJ5LXJ1biAgICAgICAgICAgRG8gbm90IG91dHB1dCBhbnl0aGluZywgYnV0IGluc3RlYWQganVzdCBzaG93IHdoYXQgYWN0aW9ucyB3b3VsZCBiZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJmb3JtZWQuIERlZmF1bHQgdG8gdHJ1ZSBpZiBkZWJ1ZyBpcyBhbHNvIHRydWUuXG5cbiAgICAgIC0tZm9yY2UgICAgICAgICAgICAgRm9yY2Ugb3ZlcndyaXRpbmcgZmlsZXMgdGhhdCB3b3VsZCBvdGhlcndpc2UgYmUgYW4gZXJyb3IuXG5cbiAgICAgIC0tbGlzdC1zY2hlbWF0aWNzICAgTGlzdCBhbGwgc2NoZW1hdGljcyBmcm9tIHRoZSBjb2xsZWN0aW9uLCBieSBuYW1lLiBBIGNvbGxlY3Rpb24gbmFtZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBzaG91bGQgYmUgc3VmZml4ZWQgYnkgYSBjb2xvbi4gRXhhbXBsZTogJ0BzY2hlbWF0aWNzL3NjaGVtYXRpY3M6Jy5cblxuICAgICAgLS12ZXJib3NlICAgICAgICAgICBTaG93IG1vcmUgaW5mb3JtYXRpb24uXG5cbiAgICAgIC0taGVscCAgICAgICAgICAgICAgU2hvdyB0aGlzIG1lc3NhZ2UuXG5cbiAgQW55IGFkZGl0aW9uYWwgb3B0aW9uIGlzIHBhc3NlZCB0byB0aGUgU2NoZW1hdGljcyBkZXBlbmRpbmcgb25cbiAgYDtcbn1cblxuLyoqIFBhcnNlIHRoZSBjb21tYW5kIGxpbmUuICovXG5jb25zdCBib29sZWFuQXJncyA9IFtcbiAgJ2FsbG93UHJpdmF0ZScsXG4gICdhbGxvdy1wcml2YXRlJyxcbiAgJ2RlYnVnJyxcbiAgJ2RyeS1ydW4nLFxuICAnZHJ5UnVuJyxcbiAgJ2ZvcmNlJyxcbiAgJ2hlbHAnLFxuICAnbGlzdC1zY2hlbWF0aWNzJyxcbiAgJ2xpc3RTY2hlbWF0aWNzJyxcbiAgJ3ZlcmJvc2UnLFxuXTtcblxuZnVuY3Rpb24gcGFyc2VBcmdzKGFyZ3M6IHN0cmluZ1tdIHwgdW5kZWZpbmVkKTogbWluaW1pc3QuUGFyc2VkQXJncyB7XG4gICAgcmV0dXJuIG1pbmltaXN0KGFyZ3MsIHtcbiAgICAgIGJvb2xlYW46IGJvb2xlYW5BcmdzLFxuICAgICAgYWxpYXM6IHtcbiAgICAgICAgJ2RyeVJ1bic6ICdkcnktcnVuJyxcbiAgICAgICAgJ2xpc3RTY2hlbWF0aWNzJzogJ2xpc3Qtc2NoZW1hdGljcycsXG4gICAgICAgICdhbGxvd1ByaXZhdGUnOiAnYWxsb3ctcHJpdmF0ZScsXG4gICAgICB9LFxuICAgICAgZGVmYXVsdDoge1xuICAgICAgICAnZGVidWcnOiBudWxsLFxuICAgICAgICAnZHJ5UnVuJzogbnVsbCxcbiAgICAgIH0sXG4gICAgICAnLS0nOiB0cnVlLFxuICAgIH0pO1xufVxuXG5pZiAocmVxdWlyZS5tYWluID09PSBtb2R1bGUpIHtcbiAgY29uc3QgYXJncyA9IHByb2Nlc3MuYXJndi5zbGljZSgyKTtcbiAgbWFpbih7IGFyZ3MgfSlcbiAgICAudGhlbihleGl0Q29kZSA9PiBwcm9jZXNzLmV4aXRDb2RlID0gZXhpdENvZGUpXG4gICAgLmNhdGNoKGUgPT4geyB0aHJvdyAoZSk7IH0pO1xufVxuIl19