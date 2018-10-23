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
    const argv = minimist(args, {
        boolean: booleanArgs,
        default: {
            'debug': null,
            'dry-run': null,
        },
        '--': true,
    });
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
        const engineHost = isLocalCollection
            ? new tools_1.FileSystemEngineHost(core_1.normalize(process.cwd()))
            : new tools_1.NodeModulesEngineHost();
        const engine = new schematics_1.SchematicEngine(engineHost);
        const collection = engine.createCollection(collectionName);
        logger.info(engine.listSchematicNames(collection).join('\n'));
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

      --allowPrivate      Allow private schematics to be run from the command line. Default to
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
if (require.main === module) {
    const args = process.argv.slice(2);
    main({ args })
        .then(exitCode => process.exitCode = exitCode)
        .catch(e => { throw (e); });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hdGljcy5qcyIsInNvdXJjZVJvb3QiOiIuLyIsInNvdXJjZXMiOlsicGFja2FnZXMvYW5ndWxhcl9kZXZraXQvc2NoZW1hdGljc19jbGkvYmluL3NjaGVtYXRpY3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBU0EsNkJBQTJCO0FBQzNCLGdDQUFnQztBQUNoQyx5REFBeUQ7QUFDekQsK0NBTThCO0FBQzlCLG9EQUErRjtBQUMvRiwyREFJb0M7QUFDcEMsNERBSTBDO0FBQzFDLHFDQUFxQztBQUdyQzs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxHQUFrQjtJQUM1QyxJQUFJLFVBQVUsR0FBRyx3QkFBd0IsQ0FBQztJQUUxQyxJQUFJLFNBQVMsR0FBRyxHQUFHLENBQUM7SUFDcEIsSUFBSSxTQUFTLElBQUksU0FBUyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsRUFBRTtRQUM3QyxDQUFDLFVBQVUsRUFBRSxTQUFTLENBQUMsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQztLQUNuRDtJQUVELE9BQU8sRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFDbkMsQ0FBQztBQVNNLEtBQUssVUFBVSxJQUFJLENBQUMsRUFDekIsSUFBSSxFQUNKLE1BQU0sR0FBRyxPQUFPLENBQUMsTUFBTSxFQUN2QixNQUFNLEdBQUcsT0FBTyxDQUFDLE1BQU0sR0FDWDtJQUVaLDhCQUE4QjtJQUM5QixNQUFNLFdBQVcsR0FBRztRQUNsQixjQUFjO1FBQ2QsT0FBTztRQUNQLFNBQVM7UUFDVCxPQUFPO1FBQ1AsTUFBTTtRQUNOLGlCQUFpQjtRQUNqQixTQUFTO0tBQ1YsQ0FBQztJQUNGLE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxJQUFJLEVBQUU7UUFDMUIsT0FBTyxFQUFFLFdBQVc7UUFDcEIsT0FBTyxFQUFFO1lBQ1AsT0FBTyxFQUFFLElBQUk7WUFDYixTQUFTLEVBQUUsSUFBSTtTQUNoQjtRQUNELElBQUksRUFBRSxJQUFJO0tBQ1gsQ0FBQyxDQUFDO0lBRUgscURBQXFEO0lBQ3JELE1BQU0sTUFBTSxHQUFHLDBCQUFtQixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFFcEUsSUFBSSxJQUFJLENBQUMsSUFBSSxFQUFFO1FBQ2IsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO1FBRXhCLE9BQU8sQ0FBQyxDQUFDO0tBQ1Y7SUFFRCxvRUFBb0U7SUFDcEUsTUFBTSxFQUNKLFVBQVUsRUFBRSxjQUFjLEVBQzFCLFNBQVMsRUFBRSxhQUFhLEdBQ3pCLEdBQUcsa0JBQWtCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxJQUFJLENBQUMsQ0FBQztJQUMvQyxNQUFNLGlCQUFpQixHQUFHLGNBQWMsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLElBQUksY0FBYyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUczRixvRkFBb0Y7SUFDcEYsSUFBSSxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBRTtRQUMzQixNQUFNLFVBQVUsR0FBRyxpQkFBaUI7WUFDbEMsQ0FBQyxDQUFDLElBQUksNEJBQW9CLENBQUMsZ0JBQVMsQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztZQUNwRCxDQUFDLENBQUMsSUFBSSw2QkFBcUIsRUFBRSxDQUFDO1FBRWhDLE1BQU0sTUFBTSxHQUFHLElBQUksNEJBQWUsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUMvQyxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsZ0JBQWdCLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDM0QsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsa0JBQWtCLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFFOUQsT0FBTyxDQUFDLENBQUM7S0FDVjtJQUVELElBQUksQ0FBQyxhQUFhLEVBQUU7UUFDbEIsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO1FBRXhCLE9BQU8sQ0FBQyxDQUFDO0tBQ1Y7SUFFRCwwQ0FBMEM7SUFDMUMsTUFBTSxLQUFLLEdBQVksSUFBSSxDQUFDLEtBQUssS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQzVFLE1BQU0sTUFBTSxHQUFZLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQzNFLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUM1QixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUM7SUFFMUMsMEVBQTBFO0lBQzFFLE1BQU0sTUFBTSxHQUFHLElBQUksZ0JBQVMsQ0FBQyxVQUFVLENBQUMsSUFBSSxxQkFBYyxFQUFFLEVBQUUsZ0JBQVMsQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDO0lBRXhGLCtEQUErRDtJQUMvRCxNQUFNLFFBQVEsR0FBRyxJQUFJLG9CQUFZLENBQUMsTUFBTSxFQUFFLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUM7SUFFN0QsaUdBQWlHO0lBQ2pHLHFCQUFxQjtJQUNyQixJQUFJLFdBQVcsR0FBRyxJQUFJLENBQUM7SUFFdkIsOEZBQThGO0lBQzlGLG1CQUFtQjtJQUNuQixJQUFJLFlBQVksR0FBYSxFQUFFLENBQUM7SUFDaEMsSUFBSSxLQUFLLEdBQUcsS0FBSyxDQUFDO0lBRWxCOzs7Ozs7Ozs7T0FTRztJQUNILFFBQVEsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUMsS0FBa0IsRUFBRSxFQUFFO1FBQ2pELFdBQVcsR0FBRyxLQUFLLENBQUM7UUFFcEIsUUFBUSxLQUFLLENBQUMsSUFBSSxFQUFFO1lBQ2xCLEtBQUssT0FBTztnQkFDVixLQUFLLEdBQUcsSUFBSSxDQUFDO2dCQUViLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxXQUFXLElBQUksY0FBYyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUM7Z0JBQ3ZGLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxLQUFLLENBQUMsSUFBSSxJQUFJLElBQUksR0FBRyxDQUFDLENBQUM7Z0JBQzdDLE1BQU07WUFDUixLQUFLLFFBQVE7Z0JBQ1gsWUFBWSxDQUFDLElBQUksQ0FBQyxXQUFJLENBQUMsT0FBTyxDQUFBO1VBQzVCLGVBQVEsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU07T0FDbEUsQ0FBQyxDQUFDO2dCQUNELE1BQU07WUFDUixLQUFLLFFBQVE7Z0JBQ1gsWUFBWSxDQUFDLElBQUksQ0FBQyxXQUFJLENBQUMsT0FBTyxDQUFBO1VBQzVCLGVBQVEsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU07T0FDbEUsQ0FBQyxDQUFDO2dCQUNELE1BQU07WUFDUixLQUFLLFFBQVE7Z0JBQ1gsWUFBWSxDQUFDLElBQUksQ0FBQyxHQUFHLGVBQVEsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7Z0JBQ2hFLE1BQU07WUFDUixLQUFLLFFBQVE7Z0JBQ1gsWUFBWSxDQUFDLElBQUksQ0FBQyxHQUFHLGVBQVEsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksT0FBTyxLQUFLLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDN0UsTUFBTTtTQUNUO0lBQ0gsQ0FBQyxDQUFDLENBQUM7SUFHSDs7T0FFRztJQUNILFFBQVEsQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxFQUFFO1FBQ25DLElBQUksS0FBSyxDQUFDLElBQUksSUFBSSxjQUFjLElBQUksS0FBSyxDQUFDLElBQUksSUFBSSxrQkFBa0IsRUFBRTtZQUNwRSxJQUFJLENBQUMsS0FBSyxFQUFFO2dCQUNWLGlEQUFpRDtnQkFDakQsWUFBWSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQzthQUMvQztZQUVELFlBQVksR0FBRyxFQUFFLENBQUM7WUFDbEIsS0FBSyxHQUFHLEtBQUssQ0FBQztTQUNmO0lBQ0gsQ0FBQyxDQUFDLENBQUM7SUFHSDs7T0FFRztJQUNILE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQzNDLE9BQU8sVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3hCLEtBQUssTUFBTSxHQUFHLElBQUksV0FBVyxFQUFFO1FBQzdCLE9BQU8sVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0tBQ3hCO0lBRUQ7O09BRUc7SUFDSCxNQUFNLEtBQUssR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDbkMsS0FBSyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFO1FBQ3BDLFVBQVUsQ0FBQyxHQUFHLENBQUMsR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7S0FDOUI7SUFFRCw4RUFBOEU7SUFDOUUsUUFBUSxDQUFDLFFBQVEsQ0FBQyx1QkFBdUIsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxNQUFrQixFQUFFLEVBQUU7UUFDdkUsSUFBSSxPQUFPLElBQUksTUFBTSxFQUFFO1lBQ3JCLE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztTQUN4QzthQUFNO1lBQ0wsT0FBTyxJQUFJLENBQUMsQ0FBQyxDQUFDO1NBQ2Y7SUFDSCxDQUFDLENBQUMsQ0FBQztJQUNILE9BQU8sVUFBVSxDQUFDLENBQUMsQ0FBQztJQUdwQjs7Ozs7OztPQU9HO0lBQ0gsSUFBSTtRQUNGLE1BQU0sUUFBUSxDQUFDLE9BQU8sQ0FBQztZQUNyQixVQUFVLEVBQUUsY0FBYztZQUMxQixTQUFTLEVBQUUsYUFBYTtZQUN4QixPQUFPLEVBQUUsVUFBVTtZQUNuQixZQUFZLEVBQUUsWUFBWTtZQUMxQixLQUFLLEVBQUUsS0FBSztZQUNaLE1BQU0sRUFBRSxNQUFNO1NBQ2YsQ0FBQzthQUNDLFNBQVMsRUFBRSxDQUFDO1FBRWYsSUFBSSxXQUFXLEVBQUU7WUFDZixNQUFNLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLENBQUM7U0FDcEM7UUFFRCxPQUFPLENBQUMsQ0FBQztLQUVWO0lBQUMsT0FBTyxHQUFHLEVBQUU7UUFDWixJQUFJLEdBQUcsWUFBWSwwQ0FBNkIsRUFBRTtZQUNoRCxvREFBb0Q7WUFDcEQsTUFBTSxDQUFDLEtBQUssQ0FBQywyQ0FBMkMsQ0FBQyxDQUFDO1NBQzNEO2FBQU0sSUFBSSxLQUFLLEVBQUU7WUFDaEIsTUFBTSxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUM7U0FDakQ7YUFBTTtZQUNMLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEtBQUssSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7U0FDeEM7UUFFRCxPQUFPLENBQUMsQ0FBQztLQUNWO0FBQ0gsQ0FBQztBQTNNRCxvQkEyTUM7QUFFQTs7RUFFRTtBQUNILFNBQVMsUUFBUTtJQUNmLE9BQU8sV0FBSSxDQUFDLFdBQVcsQ0FBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0EwQnRCLENBQUM7QUFDSixDQUFDO0FBRUQsSUFBSSxPQUFPLENBQUMsSUFBSSxLQUFLLE1BQU0sRUFBRTtJQUMzQixNQUFNLElBQUksR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNuQyxJQUFJLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQztTQUNYLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1NBQzdDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0NBQy9CIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgJ3N5bWJvbC1vYnNlcnZhYmxlJztcbi8vIHN5bWJvbCBwb2x5ZmlsbCBtdXN0IGdvIGZpcnN0XG4vLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6b3JkZXJlZC1pbXBvcnRzIGltcG9ydC1ncm91cHNcbmltcG9ydCB7XG4gIEpzb25PYmplY3QsXG4gIG5vcm1hbGl6ZSxcbiAgdGFncyxcbiAgdGVybWluYWwsXG4gIHZpcnR1YWxGcyxcbn0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgTm9kZUpzU3luY0hvc3QsIFByb2Nlc3NPdXRwdXQsIGNyZWF0ZUNvbnNvbGVMb2dnZXIgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZS9ub2RlJztcbmltcG9ydCB7XG4gIERyeVJ1bkV2ZW50LFxuICBTY2hlbWF0aWNFbmdpbmUsXG4gIFVuc3VjY2Vzc2Z1bFdvcmtmbG93RXhlY3V0aW9uLFxufSBmcm9tICdAYW5ndWxhci1kZXZraXQvc2NoZW1hdGljcyc7XG5pbXBvcnQge1xuICBGaWxlU3lzdGVtRW5naW5lSG9zdCxcbiAgTm9kZU1vZHVsZXNFbmdpbmVIb3N0LFxuICBOb2RlV29ya2Zsb3csXG59IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzL3Rvb2xzJztcbmltcG9ydCAqIGFzIG1pbmltaXN0IGZyb20gJ21pbmltaXN0JztcblxuXG4vKipcbiAqIFBhcnNlIHRoZSBuYW1lIG9mIHNjaGVtYXRpYyBwYXNzZWQgaW4gYXJndW1lbnQsIGFuZCByZXR1cm4gYSB7Y29sbGVjdGlvbiwgc2NoZW1hdGljfSBuYW1lZFxuICogdHVwbGUuIFRoZSB1c2VyIGNhbiBwYXNzIGluIGBjb2xsZWN0aW9uLW5hbWU6c2NoZW1hdGljLW5hbWVgLCBhbmQgdGhpcyBmdW5jdGlvbiB3aWxsIGVpdGhlclxuICogcmV0dXJuIGB7Y29sbGVjdGlvbjogJ2NvbGxlY3Rpb24tbmFtZScsIHNjaGVtYXRpYzogJ3NjaGVtYXRpYy1uYW1lJ31gLCBvciBpdCB3aWxsIGVycm9yIG91dFxuICogYW5kIHNob3cgdXNhZ2UuXG4gKlxuICogSW4gdGhlIGNhc2Ugd2hlcmUgYSBjb2xsZWN0aW9uIG5hbWUgaXNuJ3QgcGFydCBvZiB0aGUgYXJndW1lbnQsIHRoZSBkZWZhdWx0IGlzIHRvIHVzZSB0aGVcbiAqIHNjaGVtYXRpY3MgcGFja2FnZSAoQHNjaGVtYXRpY3Mvc2NoZW1hdGljcykgYXMgdGhlIGNvbGxlY3Rpb24uXG4gKlxuICogVGhpcyBsb2dpYyBpcyBlbnRpcmVseSB1cCB0byB0aGUgdG9vbGluZy5cbiAqXG4gKiBAcGFyYW0gc3RyIFRoZSBhcmd1bWVudCB0byBwYXJzZS5cbiAqIEByZXR1cm4ge3tjb2xsZWN0aW9uOiBzdHJpbmcsIHNjaGVtYXRpYzogKHN0cmluZyl9fVxuICovXG5mdW5jdGlvbiBwYXJzZVNjaGVtYXRpY05hbWUoc3RyOiBzdHJpbmcgfCBudWxsKTogeyBjb2xsZWN0aW9uOiBzdHJpbmcsIHNjaGVtYXRpYzogc3RyaW5nIHwgbnVsbCB9IHtcbiAgbGV0IGNvbGxlY3Rpb24gPSAnQHNjaGVtYXRpY3Mvc2NoZW1hdGljcyc7XG5cbiAgbGV0IHNjaGVtYXRpYyA9IHN0cjtcbiAgaWYgKHNjaGVtYXRpYyAmJiBzY2hlbWF0aWMuaW5kZXhPZignOicpICE9IC0xKSB7XG4gICAgW2NvbGxlY3Rpb24sIHNjaGVtYXRpY10gPSBzY2hlbWF0aWMuc3BsaXQoJzonLCAyKTtcbiAgfVxuXG4gIHJldHVybiB7IGNvbGxlY3Rpb24sIHNjaGVtYXRpYyB9O1xufVxuXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWFpbk9wdGlvbnMge1xuICBhcmdzOiBzdHJpbmdbXTtcbiAgc3Rkb3V0PzogUHJvY2Vzc091dHB1dDtcbiAgc3RkZXJyPzogUHJvY2Vzc091dHB1dDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1haW4oe1xuICBhcmdzLFxuICBzdGRvdXQgPSBwcm9jZXNzLnN0ZG91dCxcbiAgc3RkZXJyID0gcHJvY2Vzcy5zdGRlcnIsXG59OiBNYWluT3B0aW9ucyk6IFByb21pc2U8MCB8IDE+IHtcblxuICAvKiogUGFyc2UgdGhlIGNvbW1hbmQgbGluZS4gKi9cbiAgY29uc3QgYm9vbGVhbkFyZ3MgPSBbXG4gICAgJ2FsbG93UHJpdmF0ZScsXG4gICAgJ2RlYnVnJyxcbiAgICAnZHJ5LXJ1bicsXG4gICAgJ2ZvcmNlJyxcbiAgICAnaGVscCcsXG4gICAgJ2xpc3Qtc2NoZW1hdGljcycsXG4gICAgJ3ZlcmJvc2UnLFxuICBdO1xuICBjb25zdCBhcmd2ID0gbWluaW1pc3QoYXJncywge1xuICAgIGJvb2xlYW46IGJvb2xlYW5BcmdzLFxuICAgIGRlZmF1bHQ6IHtcbiAgICAgICdkZWJ1Zyc6IG51bGwsXG4gICAgICAnZHJ5LXJ1bic6IG51bGwsXG4gICAgfSxcbiAgICAnLS0nOiB0cnVlLFxuICB9KTtcblxuICAvKiogQ3JlYXRlIHRoZSBEZXZLaXQgTG9nZ2VyIHVzZWQgdGhyb3VnaCB0aGUgQ0xJLiAqL1xuICBjb25zdCBsb2dnZXIgPSBjcmVhdGVDb25zb2xlTG9nZ2VyKGFyZ3ZbJ3ZlcmJvc2UnXSwgc3Rkb3V0LCBzdGRlcnIpO1xuXG4gIGlmIChhcmd2LmhlbHApIHtcbiAgICBsb2dnZXIuaW5mbyhnZXRVc2FnZSgpKTtcblxuICAgIHJldHVybiAwO1xuICB9XG5cbiAgLyoqIEdldCB0aGUgY29sbGVjdGlvbiBhbiBzY2hlbWF0aWMgbmFtZSBmcm9tIHRoZSBmaXJzdCBhcmd1bWVudC4gKi9cbiAgY29uc3Qge1xuICAgIGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLFxuICAgIHNjaGVtYXRpYzogc2NoZW1hdGljTmFtZSxcbiAgfSA9IHBhcnNlU2NoZW1hdGljTmFtZShhcmd2Ll8uc2hpZnQoKSB8fCBudWxsKTtcbiAgY29uc3QgaXNMb2NhbENvbGxlY3Rpb24gPSBjb2xsZWN0aW9uTmFtZS5zdGFydHNXaXRoKCcuJykgfHwgY29sbGVjdGlvbk5hbWUuc3RhcnRzV2l0aCgnLycpO1xuXG5cbiAgLyoqIElmIHRoZSB1c2VyIHdhbnRzIHRvIGxpc3Qgc2NoZW1hdGljcywgd2Ugc2ltcGx5IHNob3cgYWxsIHRoZSBzY2hlbWF0aWMgbmFtZXMuICovXG4gIGlmIChhcmd2WydsaXN0LXNjaGVtYXRpY3MnXSkge1xuICAgIGNvbnN0IGVuZ2luZUhvc3QgPSBpc0xvY2FsQ29sbGVjdGlvblxuICAgICAgPyBuZXcgRmlsZVN5c3RlbUVuZ2luZUhvc3Qobm9ybWFsaXplKHByb2Nlc3MuY3dkKCkpKVxuICAgICAgOiBuZXcgTm9kZU1vZHVsZXNFbmdpbmVIb3N0KCk7XG5cbiAgICBjb25zdCBlbmdpbmUgPSBuZXcgU2NoZW1hdGljRW5naW5lKGVuZ2luZUhvc3QpO1xuICAgIGNvbnN0IGNvbGxlY3Rpb24gPSBlbmdpbmUuY3JlYXRlQ29sbGVjdGlvbihjb2xsZWN0aW9uTmFtZSk7XG4gICAgbG9nZ2VyLmluZm8oZW5naW5lLmxpc3RTY2hlbWF0aWNOYW1lcyhjb2xsZWN0aW9uKS5qb2luKCdcXG4nKSk7XG5cbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIGlmICghc2NoZW1hdGljTmFtZSkge1xuICAgIGxvZ2dlci5pbmZvKGdldFVzYWdlKCkpO1xuXG4gICAgcmV0dXJuIDE7XG4gIH1cblxuICAvKiogR2F0aGVyIHRoZSBhcmd1bWVudHMgZm9yIGxhdGVyIHVzZS4gKi9cbiAgY29uc3QgZGVidWc6IGJvb2xlYW4gPSBhcmd2LmRlYnVnID09PSBudWxsID8gaXNMb2NhbENvbGxlY3Rpb24gOiBhcmd2LmRlYnVnO1xuICBjb25zdCBkcnlSdW46IGJvb2xlYW4gPSBhcmd2WydkcnktcnVuJ10gPT09IG51bGwgPyBkZWJ1ZyA6IGFyZ3ZbJ2RyeS1ydW4nXTtcbiAgY29uc3QgZm9yY2UgPSBhcmd2Wydmb3JjZSddO1xuICBjb25zdCBhbGxvd1ByaXZhdGUgPSBhcmd2WydhbGxvd1ByaXZhdGUnXTtcblxuICAvKiogQ3JlYXRlIGEgVmlydHVhbCBGUyBIb3N0IHNjb3BlZCB0byB3aGVyZSB0aGUgcHJvY2VzcyBpcyBiZWluZyBydW4uICoqL1xuICBjb25zdCBmc0hvc3QgPSBuZXcgdmlydHVhbEZzLlNjb3BlZEhvc3QobmV3IE5vZGVKc1N5bmNIb3N0KCksIG5vcm1hbGl6ZShwcm9jZXNzLmN3ZCgpKSk7XG5cbiAgLyoqIENyZWF0ZSB0aGUgd29ya2Zsb3cgdGhhdCB3aWxsIGJlIGV4ZWN1dGVkIHdpdGggdGhpcyBydW4uICovXG4gIGNvbnN0IHdvcmtmbG93ID0gbmV3IE5vZGVXb3JrZmxvdyhmc0hvc3QsIHsgZm9yY2UsIGRyeVJ1biB9KTtcblxuICAvLyBJbmRpY2F0ZSB0byB0aGUgdXNlciB3aGVuIG5vdGhpbmcgaGFzIGJlZW4gZG9uZS4gVGhpcyBpcyBhdXRvbWF0aWNhbGx5IHNldCB0byBvZmYgd2hlbiB0aGVyZSdzXG4gIC8vIGEgbmV3IERyeVJ1bkV2ZW50LlxuICBsZXQgbm90aGluZ0RvbmUgPSB0cnVlO1xuXG4gIC8vIExvZ2dpbmcgcXVldWUgdGhhdCByZWNlaXZlcyBhbGwgdGhlIG1lc3NhZ2VzIHRvIHNob3cgdGhlIHVzZXJzLiBUaGlzIG9ubHkgZ2V0IHNob3duIHdoZW4gbm9cbiAgLy8gZXJyb3JzIGhhcHBlbmVkLlxuICBsZXQgbG9nZ2luZ1F1ZXVlOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgZXJyb3IgPSBmYWxzZTtcblxuICAvKipcbiAgICogTG9ncyBvdXQgZHJ5IHJ1biBldmVudHMuXG4gICAqXG4gICAqIEFsbCBldmVudHMgd2lsbCBhbHdheXMgYmUgZXhlY3V0ZWQgaGVyZSwgaW4gb3JkZXIgb2YgZGlzY292ZXJ5LiBUaGF0IG1lYW5zIHRoYXQgYW4gZXJyb3Igd291bGRcbiAgICogYmUgc2hvd24gYWxvbmcgb3RoZXIgZXZlbnRzIHdoZW4gaXQgaGFwcGVucy4gU2luY2UgZXJyb3JzIGluIHdvcmtmbG93cyB3aWxsIHN0b3AgdGhlIE9ic2VydmFibGVcbiAgICogZnJvbSBjb21wbGV0aW5nIHN1Y2Nlc3NmdWxseSwgd2UgcmVjb3JkIGFueSBldmVudHMgb3RoZXIgdGhhbiBlcnJvcnMsIHRoZW4gb24gY29tcGxldGlvbiB3ZVxuICAgKiBzaG93IHRoZW0uXG4gICAqXG4gICAqIFRoaXMgaXMgYSBzaW1wbGUgd2F5IHRvIG9ubHkgc2hvdyBlcnJvcnMgd2hlbiBhbiBlcnJvciBvY2N1ci5cbiAgICovXG4gIHdvcmtmbG93LnJlcG9ydGVyLnN1YnNjcmliZSgoZXZlbnQ6IERyeVJ1bkV2ZW50KSA9PiB7XG4gICAgbm90aGluZ0RvbmUgPSBmYWxzZTtcblxuICAgIHN3aXRjaCAoZXZlbnQua2luZCkge1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgICBlcnJvciA9IHRydWU7XG5cbiAgICAgICAgY29uc3QgZGVzYyA9IGV2ZW50LmRlc2NyaXB0aW9uID09ICdhbHJlYWR5RXhpc3QnID8gJ2FscmVhZHkgZXhpc3RzJyA6ICdkb2VzIG5vdCBleGlzdCc7XG4gICAgICAgIGxvZ2dlci53YXJuKGBFUlJPUiEgJHtldmVudC5wYXRofSAke2Rlc2N9LmApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICAgIGxvZ2dpbmdRdWV1ZS5wdXNoKHRhZ3Mub25lTGluZWBcbiAgICAgICAgJHt0ZXJtaW5hbC53aGl0ZSgnVVBEQVRFJyl9ICR7ZXZlbnQucGF0aH0gKCR7ZXZlbnQuY29udGVudC5sZW5ndGh9IGJ5dGVzKVxuICAgICAgYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2godGFncy5vbmVMaW5lYFxuICAgICAgICAke3Rlcm1pbmFsLmdyZWVuKCdDUkVBVEUnKX0gJHtldmVudC5wYXRofSAoJHtldmVudC5jb250ZW50Lmxlbmd0aH0gYnl0ZXMpXG4gICAgICBgKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdkZWxldGUnOlxuICAgICAgICBsb2dnaW5nUXVldWUucHVzaChgJHt0ZXJtaW5hbC55ZWxsb3coJ0RFTEVURScpfSAke2V2ZW50LnBhdGh9YCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAncmVuYW1lJzpcbiAgICAgICAgbG9nZ2luZ1F1ZXVlLnB1c2goYCR7dGVybWluYWwuYmx1ZSgnUkVOQU1FJyl9ICR7ZXZlbnQucGF0aH0gPT4gJHtldmVudC50b31gKTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiBMaXN0ZW4gdG8gbGlmZWN5Y2xlIGV2ZW50cyBvZiB0aGUgd29ya2Zsb3cgdG8gZmx1c2ggdGhlIGxvZ3MgYmV0d2VlbiBlYWNoIHBoYXNlcy5cbiAgICovXG4gIHdvcmtmbG93LmxpZmVDeWNsZS5zdWJzY3JpYmUoZXZlbnQgPT4ge1xuICAgIGlmIChldmVudC5raW5kID09ICd3b3JrZmxvdy1lbmQnIHx8IGV2ZW50LmtpbmQgPT0gJ3Bvc3QtdGFza3Mtc3RhcnQnKSB7XG4gICAgICBpZiAoIWVycm9yKSB7XG4gICAgICAgIC8vIEZsdXNoIHRoZSBsb2cgcXVldWUgYW5kIGNsZWFuIHRoZSBlcnJvciBzdGF0ZS5cbiAgICAgICAgbG9nZ2luZ1F1ZXVlLmZvckVhY2gobG9nID0+IGxvZ2dlci5pbmZvKGxvZykpO1xuICAgICAgfVxuXG4gICAgICBsb2dnaW5nUXVldWUgPSBbXTtcbiAgICAgIGVycm9yID0gZmFsc2U7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiBSZW1vdmUgZXZlcnkgb3B0aW9ucyBmcm9tIGFyZ3YgdGhhdCB3ZSBzdXBwb3J0IGluIHNjaGVtYXRpY3MgaXRzZWxmLlxuICAgKi9cbiAgY29uc3QgcGFyc2VkQXJncyA9IE9iamVjdC5hc3NpZ24oe30sIGFyZ3YpO1xuICBkZWxldGUgcGFyc2VkQXJnc1snLS0nXTtcbiAgZm9yIChjb25zdCBrZXkgb2YgYm9vbGVhbkFyZ3MpIHtcbiAgICBkZWxldGUgcGFyc2VkQXJnc1trZXldO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZCBvcHRpb25zIGZyb20gYC0tYCB0byBhcmdzLlxuICAgKi9cbiAgY29uc3QgYXJndjIgPSBtaW5pbWlzdChhcmd2WyctLSddKTtcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoYXJndjIpKSB7XG4gICAgcGFyc2VkQXJnc1trZXldID0gYXJndjJba2V5XTtcbiAgfVxuXG4gIC8vIFBhc3MgdGhlIHJlc3Qgb2YgdGhlIGFyZ3VtZW50cyBhcyB0aGUgc21hcnQgZGVmYXVsdCBcImFyZ3ZcIi4gVGhlbiBkZWxldGUgaXQuXG4gIHdvcmtmbG93LnJlZ2lzdHJ5LmFkZFNtYXJ0RGVmYXVsdFByb3ZpZGVyKCdhcmd2JywgKHNjaGVtYTogSnNvbk9iamVjdCkgPT4ge1xuICAgIGlmICgnaW5kZXgnIGluIHNjaGVtYSkge1xuICAgICAgcmV0dXJuIGFyZ3YuX1tOdW1iZXIoc2NoZW1hWydpbmRleCddKV07XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBhcmd2Ll87XG4gICAgfVxuICB9KTtcbiAgZGVsZXRlIHBhcnNlZEFyZ3MuXztcblxuXG4gIC8qKlxuICAgKiAgRXhlY3V0ZSB0aGUgd29ya2Zsb3csIHdoaWNoIHdpbGwgcmVwb3J0IHRoZSBkcnkgcnVuIGV2ZW50cywgcnVuIHRoZSB0YXNrcywgYW5kIGNvbXBsZXRlXG4gICAqICBhZnRlciBhbGwgaXMgZG9uZS5cbiAgICpcbiAgICogIFRoZSBPYnNlcnZhYmxlIHJldHVybmVkIHdpbGwgcHJvcGVybHkgY2FuY2VsIHRoZSB3b3JrZmxvdyBpZiB1bnN1YnNjcmliZWQsIGVycm9yIG91dCBpZiBBTllcbiAgICogIHN0ZXAgb2YgdGhlIHdvcmtmbG93IGZhaWxlZCAoc2luayBvciB0YXNrKSwgd2l0aCBkZXRhaWxzIGluY2x1ZGVkLCBhbmQgd2lsbCBvbmx5IGNvbXBsZXRlXG4gICAqICB3aGVuIGV2ZXJ5dGhpbmcgaXMgZG9uZS5cbiAgICovXG4gIHRyeSB7XG4gICAgYXdhaXQgd29ya2Zsb3cuZXhlY3V0ZSh7XG4gICAgICBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSxcbiAgICAgIHNjaGVtYXRpYzogc2NoZW1hdGljTmFtZSxcbiAgICAgIG9wdGlvbnM6IHBhcnNlZEFyZ3MsXG4gICAgICBhbGxvd1ByaXZhdGU6IGFsbG93UHJpdmF0ZSxcbiAgICAgIGRlYnVnOiBkZWJ1ZyxcbiAgICAgIGxvZ2dlcjogbG9nZ2VyLFxuICAgIH0pXG4gICAgICAudG9Qcm9taXNlKCk7XG5cbiAgICBpZiAobm90aGluZ0RvbmUpIHtcbiAgICAgIGxvZ2dlci5pbmZvKCdOb3RoaW5nIHRvIGJlIGRvbmUuJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIDA7XG5cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgaWYgKGVyciBpbnN0YW5jZW9mIFVuc3VjY2Vzc2Z1bFdvcmtmbG93RXhlY3V0aW9uKSB7XG4gICAgICAvLyBcIlNlZSBhYm92ZVwiIGJlY2F1c2Ugd2UgYWxyZWFkeSBwcmludGVkIHRoZSBlcnJvci5cbiAgICAgIGxvZ2dlci5mYXRhbCgnVGhlIFNjaGVtYXRpYyB3b3JrZmxvdyBmYWlsZWQuIFNlZSBhYm92ZS4nKTtcbiAgICB9IGVsc2UgaWYgKGRlYnVnKSB7XG4gICAgICBsb2dnZXIuZmF0YWwoJ0FuIGVycm9yIG9jY3VyZWQ6XFxuJyArIGVyci5zdGFjayk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvZ2dlci5mYXRhbChlcnIuc3RhY2sgfHwgZXJyLm1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHJldHVybiAxO1xuICB9XG59XG5cbiAvKipcbiAqIEdldCB1c2FnZSBvZiB0aGUgQ0xJIHRvb2wuXG4gKi9cbmZ1bmN0aW9uIGdldFVzYWdlKCk6IHN0cmluZyB7XG4gIHJldHVybiB0YWdzLnN0cmlwSW5kZW50YFxuICBzY2hlbWF0aWNzIFtDb2xsZWN0aW9uTmFtZTpdU2NoZW1hdGljTmFtZSBbb3B0aW9ucywgLi4uXVxuXG4gIEJ5IGRlZmF1bHQsIGlmIHRoZSBjb2xsZWN0aW9uIG5hbWUgaXMgbm90IHNwZWNpZmllZCwgdXNlIHRoZSBpbnRlcm5hbCBjb2xsZWN0aW9uIHByb3ZpZGVkXG4gIGJ5IHRoZSBTY2hlbWF0aWNzIENMSS5cblxuICBPcHRpb25zOlxuICAgICAgLS1kZWJ1ZyAgICAgICAgICAgICBEZWJ1ZyBtb2RlLiBUaGlzIGlzIHRydWUgYnkgZGVmYXVsdCBpZiB0aGUgY29sbGVjdGlvbiBpcyBhIHJlbGF0aXZlXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGggKGluIHRoYXQgY2FzZSwgdHVybiBvZmYgd2l0aCAtLWRlYnVnPWZhbHNlKS5cblxuICAgICAgLS1hbGxvd1ByaXZhdGUgICAgICBBbGxvdyBwcml2YXRlIHNjaGVtYXRpY3MgdG8gYmUgcnVuIGZyb20gdGhlIGNvbW1hbmQgbGluZS4gRGVmYXVsdCB0b1xuICAgICAgICAgICAgICAgICAgICAgICAgICBmYWxzZS5cblxuICAgICAgLS1kcnktcnVuICAgICAgICAgICBEbyBub3Qgb3V0cHV0IGFueXRoaW5nLCBidXQgaW5zdGVhZCBqdXN0IHNob3cgd2hhdCBhY3Rpb25zIHdvdWxkIGJlXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHBlcmZvcm1lZC4gRGVmYXVsdCB0byB0cnVlIGlmIGRlYnVnIGlzIGFsc28gdHJ1ZS5cblxuICAgICAgLS1mb3JjZSAgICAgICAgICAgICBGb3JjZSBvdmVyd3JpdGluZyBmaWxlcyB0aGF0IHdvdWxkIG90aGVyd2lzZSBiZSBhbiBlcnJvci5cblxuICAgICAgLS1saXN0LXNjaGVtYXRpY3MgICBMaXN0IGFsbCBzY2hlbWF0aWNzIGZyb20gdGhlIGNvbGxlY3Rpb24sIGJ5IG5hbWUuIEEgY29sbGVjdGlvbiBuYW1lXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHNob3VsZCBiZSBzdWZmaXhlZCBieSBhIGNvbG9uLiBFeGFtcGxlOiAnQHNjaGVtYXRpY3Mvc2NoZW1hdGljczonLlxuXG4gICAgICAtLXZlcmJvc2UgICAgICAgICAgIFNob3cgbW9yZSBpbmZvcm1hdGlvbi5cblxuICAgICAgLS1oZWxwICAgICAgICAgICAgICBTaG93IHRoaXMgbWVzc2FnZS5cblxuICBBbnkgYWRkaXRpb25hbCBvcHRpb24gaXMgcGFzc2VkIHRvIHRoZSBTY2hlbWF0aWNzIGRlcGVuZGluZyBvblxuICBgO1xufVxuXG5pZiAocmVxdWlyZS5tYWluID09PSBtb2R1bGUpIHtcbiAgY29uc3QgYXJncyA9IHByb2Nlc3MuYXJndi5zbGljZSgyKTtcbiAgbWFpbih7IGFyZ3MgfSlcbiAgICAudGhlbihleGl0Q29kZSA9PiBwcm9jZXNzLmV4aXRDb2RlID0gZXhpdENvZGUpXG4gICAgLmNhdGNoKGUgPT4geyB0aHJvdyAoZSk7IH0pO1xufVxuIl19