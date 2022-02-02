"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@angular-devkit/core");
const schematics_1 = require("@angular-devkit/schematics");
const tasks_1 = require("@angular-devkit/schematics/tasks");
function addSchematicToCollectionJson(collectionPath, schematicName, description) {
    return (tree) => {
        const collectionJsonContent = tree.read(collectionPath);
        if (!collectionJsonContent) {
            throw new Error('Invalid collection path: ' + collectionPath);
        }
        const collectionJson = JSON.parse(collectionJsonContent.toString());
        if (!(0, core_1.isJsonObject)(collectionJson.schematics)) {
            throw new Error('Invalid collection.json; schematics needs to be an object.');
        }
        collectionJson['schematics'][schematicName] = description;
        tree.overwrite(collectionPath, JSON.stringify(collectionJson, undefined, 2));
    };
}
function default_1(options) {
    const schematicsVersion = require('@angular-devkit/schematics/package.json').version;
    const coreVersion = require('@angular-devkit/core/package.json').version;
    // Verify if we need to create a full project, or just add a new schematic.
    return (tree, context) => {
        if (!options.name) {
            throw new schematics_1.SchematicsException('name option is required.');
        }
        let collectionPath;
        try {
            const packageJsonContent = tree.read('/package.json');
            if (packageJsonContent) {
                const packageJson = JSON.parse(packageJsonContent.toString());
                if (typeof packageJson.schematics === 'string') {
                    const p = (0, core_1.normalize)(packageJson.schematics);
                    if (tree.exists(p)) {
                        collectionPath = p;
                    }
                }
            }
        }
        catch (_a) { }
        let source = (0, schematics_1.apply)((0, schematics_1.url)('./schematic-files'), [
            (0, schematics_1.template)({
                ...options,
                coreVersion,
                schematicsVersion,
                dot: '.',
                camelize: core_1.strings.camelize,
                dasherize: core_1.strings.dasherize,
            }),
        ]);
        // Simply create a new schematic project.
        if (!collectionPath) {
            collectionPath = (0, core_1.normalize)('/' + options.name + '/src/collection.json');
            source = (0, schematics_1.apply)((0, schematics_1.url)('./project-files'), [
                (0, schematics_1.template)({
                    ...options,
                    coreVersion,
                    schematicsVersion,
                    dot: '.',
                    camelize: core_1.strings.camelize,
                    dasherize: core_1.strings.dasherize,
                }),
                (0, schematics_1.mergeWith)(source),
                (0, schematics_1.move)(options.name),
            ]);
            context.addTask(new tasks_1.NodePackageInstallTask(options.name));
        }
        return (0, schematics_1.chain)([
            (0, schematics_1.mergeWith)(source),
            addSchematicToCollectionJson(collectionPath, core_1.strings.dasherize(options.name), {
                description: 'A blank schematic.',
                factory: './' + core_1.strings.dasherize(options.name) + '/index#' + core_1.strings.camelize(options.name),
            }),
        ]);
    };
}
exports.default = default_1;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFjdG9yeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2FuZ3VsYXJfZGV2a2l0L3NjaGVtYXRpY3NfY2xpL2JsYW5rL2ZhY3RvcnkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7QUFFSCwrQ0FBMEY7QUFDMUYsMkRBV29DO0FBQ3BDLDREQUEwRTtBQUcxRSxTQUFTLDRCQUE0QixDQUNuQyxjQUFvQixFQUNwQixhQUFxQixFQUNyQixXQUF1QjtJQUV2QixPQUFPLENBQUMsSUFBVSxFQUFFLEVBQUU7UUFDcEIsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQ3hELElBQUksQ0FBQyxxQkFBcUIsRUFBRTtZQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixHQUFHLGNBQWMsQ0FBQyxDQUFDO1NBQy9EO1FBRUQsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO1FBQ3BFLElBQUksQ0FBQyxJQUFBLG1CQUFZLEVBQUMsY0FBYyxDQUFDLFVBQVUsQ0FBQyxFQUFFO1lBQzVDLE1BQU0sSUFBSSxLQUFLLENBQUMsNERBQTRELENBQUMsQ0FBQztTQUMvRTtRQUVELGNBQWMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxhQUFhLENBQUMsR0FBRyxXQUFXLENBQUM7UUFDMUQsSUFBSSxDQUFDLFNBQVMsQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxjQUFjLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDL0UsQ0FBQyxDQUFDO0FBQ0osQ0FBQztBQUVELG1CQUF5QixPQUFlO0lBQ3RDLE1BQU0saUJBQWlCLEdBQUcsT0FBTyxDQUFDLHlDQUF5QyxDQUFDLENBQUMsT0FBTyxDQUFDO0lBQ3JGLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQztJQUV6RSwyRUFBMkU7SUFDM0UsT0FBTyxDQUFDLElBQVUsRUFBRSxPQUF5QixFQUFFLEVBQUU7UUFDL0MsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUU7WUFDakIsTUFBTSxJQUFJLGdDQUFtQixDQUFDLDBCQUEwQixDQUFDLENBQUM7U0FDM0Q7UUFFRCxJQUFJLGNBQWdDLENBQUM7UUFDckMsSUFBSTtZQUNGLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUN0RCxJQUFJLGtCQUFrQixFQUFFO2dCQUN0QixNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLGtCQUFrQixDQUFDLFFBQVEsRUFBRSxDQUUzRCxDQUFDO2dCQUNGLElBQUksT0FBTyxXQUFXLENBQUMsVUFBVSxLQUFLLFFBQVEsRUFBRTtvQkFDOUMsTUFBTSxDQUFDLEdBQUcsSUFBQSxnQkFBUyxFQUFDLFdBQVcsQ0FBQyxVQUFVLENBQUMsQ0FBQztvQkFDNUMsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFO3dCQUNsQixjQUFjLEdBQUcsQ0FBQyxDQUFDO3FCQUNwQjtpQkFDRjthQUNGO1NBQ0Y7UUFBQyxXQUFNLEdBQUU7UUFFVixJQUFJLE1BQU0sR0FBRyxJQUFBLGtCQUFLLEVBQUMsSUFBQSxnQkFBRyxFQUFDLG1CQUFtQixDQUFDLEVBQUU7WUFDM0MsSUFBQSxxQkFBUSxFQUFDO2dCQUNQLEdBQUcsT0FBTztnQkFDVixXQUFXO2dCQUNYLGlCQUFpQjtnQkFDakIsR0FBRyxFQUFFLEdBQUc7Z0JBQ1IsUUFBUSxFQUFFLGNBQU8sQ0FBQyxRQUFRO2dCQUMxQixTQUFTLEVBQUUsY0FBTyxDQUFDLFNBQVM7YUFDN0IsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILHlDQUF5QztRQUN6QyxJQUFJLENBQUMsY0FBYyxFQUFFO1lBQ25CLGNBQWMsR0FBRyxJQUFBLGdCQUFTLEVBQUMsR0FBRyxHQUFHLE9BQU8sQ0FBQyxJQUFJLEdBQUcsc0JBQXNCLENBQUMsQ0FBQztZQUN4RSxNQUFNLEdBQUcsSUFBQSxrQkFBSyxFQUFDLElBQUEsZ0JBQUcsRUFBQyxpQkFBaUIsQ0FBQyxFQUFFO2dCQUNyQyxJQUFBLHFCQUFRLEVBQUM7b0JBQ1AsR0FBSSxPQUFrQjtvQkFDdEIsV0FBVztvQkFDWCxpQkFBaUI7b0JBQ2pCLEdBQUcsRUFBRSxHQUFHO29CQUNSLFFBQVEsRUFBRSxjQUFPLENBQUMsUUFBUTtvQkFDMUIsU0FBUyxFQUFFLGNBQU8sQ0FBQyxTQUFTO2lCQUM3QixDQUFDO2dCQUNGLElBQUEsc0JBQVMsRUFBQyxNQUFNLENBQUM7Z0JBQ2pCLElBQUEsaUJBQUksRUFBQyxPQUFPLENBQUMsSUFBSSxDQUFDO2FBQ25CLENBQUMsQ0FBQztZQUVILE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSw4QkFBc0IsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztTQUMzRDtRQUVELE9BQU8sSUFBQSxrQkFBSyxFQUFDO1lBQ1gsSUFBQSxzQkFBUyxFQUFDLE1BQU0sQ0FBQztZQUNqQiw0QkFBNEIsQ0FBQyxjQUFjLEVBQUUsY0FBTyxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUU7Z0JBQzVFLFdBQVcsRUFBRSxvQkFBb0I7Z0JBQ2pDLE9BQU8sRUFDTCxJQUFJLEdBQUcsY0FBTyxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsU0FBUyxHQUFHLGNBQU8sQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQzthQUN0RixDQUFDO1NBQ0gsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDO0FBQ0osQ0FBQztBQWpFRCw0QkFpRUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0IHsgSnNvbk9iamVjdCwgUGF0aCwgaXNKc29uT2JqZWN0LCBub3JtYWxpemUsIHN0cmluZ3MgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZSc7XG5pbXBvcnQge1xuICBSdWxlLFxuICBTY2hlbWF0aWNDb250ZXh0LFxuICBTY2hlbWF0aWNzRXhjZXB0aW9uLFxuICBUcmVlLFxuICBhcHBseSxcbiAgY2hhaW4sXG4gIG1lcmdlV2l0aCxcbiAgbW92ZSxcbiAgdGVtcGxhdGUsXG4gIHVybCxcbn0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MnO1xuaW1wb3J0IHsgTm9kZVBhY2thZ2VJbnN0YWxsVGFzayB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzL3Rhc2tzJztcbmltcG9ydCB7IFNjaGVtYSB9IGZyb20gJy4vc2NoZW1hJztcblxuZnVuY3Rpb24gYWRkU2NoZW1hdGljVG9Db2xsZWN0aW9uSnNvbihcbiAgY29sbGVjdGlvblBhdGg6IFBhdGgsXG4gIHNjaGVtYXRpY05hbWU6IHN0cmluZyxcbiAgZGVzY3JpcHRpb246IEpzb25PYmplY3QsXG4pOiBSdWxlIHtcbiAgcmV0dXJuICh0cmVlOiBUcmVlKSA9PiB7XG4gICAgY29uc3QgY29sbGVjdGlvbkpzb25Db250ZW50ID0gdHJlZS5yZWFkKGNvbGxlY3Rpb25QYXRoKTtcbiAgICBpZiAoIWNvbGxlY3Rpb25Kc29uQ29udGVudCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGNvbGxlY3Rpb24gcGF0aDogJyArIGNvbGxlY3Rpb25QYXRoKTtcbiAgICB9XG5cbiAgICBjb25zdCBjb2xsZWN0aW9uSnNvbiA9IEpTT04ucGFyc2UoY29sbGVjdGlvbkpzb25Db250ZW50LnRvU3RyaW5nKCkpO1xuICAgIGlmICghaXNKc29uT2JqZWN0KGNvbGxlY3Rpb25Kc29uLnNjaGVtYXRpY3MpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgY29sbGVjdGlvbi5qc29uOyBzY2hlbWF0aWNzIG5lZWRzIHRvIGJlIGFuIG9iamVjdC4nKTtcbiAgICB9XG5cbiAgICBjb2xsZWN0aW9uSnNvblsnc2NoZW1hdGljcyddW3NjaGVtYXRpY05hbWVdID0gZGVzY3JpcHRpb247XG4gICAgdHJlZS5vdmVyd3JpdGUoY29sbGVjdGlvblBhdGgsIEpTT04uc3RyaW5naWZ5KGNvbGxlY3Rpb25Kc29uLCB1bmRlZmluZWQsIDIpKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gKG9wdGlvbnM6IFNjaGVtYSk6IFJ1bGUge1xuICBjb25zdCBzY2hlbWF0aWNzVmVyc2lvbiA9IHJlcXVpcmUoJ0Bhbmd1bGFyLWRldmtpdC9zY2hlbWF0aWNzL3BhY2thZ2UuanNvbicpLnZlcnNpb247XG4gIGNvbnN0IGNvcmVWZXJzaW9uID0gcmVxdWlyZSgnQGFuZ3VsYXItZGV2a2l0L2NvcmUvcGFja2FnZS5qc29uJykudmVyc2lvbjtcblxuICAvLyBWZXJpZnkgaWYgd2UgbmVlZCB0byBjcmVhdGUgYSBmdWxsIHByb2plY3QsIG9yIGp1c3QgYWRkIGEgbmV3IHNjaGVtYXRpYy5cbiAgcmV0dXJuICh0cmVlOiBUcmVlLCBjb250ZXh0OiBTY2hlbWF0aWNDb250ZXh0KSA9PiB7XG4gICAgaWYgKCFvcHRpb25zLm5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBTY2hlbWF0aWNzRXhjZXB0aW9uKCduYW1lIG9wdGlvbiBpcyByZXF1aXJlZC4nKTtcbiAgICB9XG5cbiAgICBsZXQgY29sbGVjdGlvblBhdGg6IFBhdGggfCB1bmRlZmluZWQ7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhY2thZ2VKc29uQ29udGVudCA9IHRyZWUucmVhZCgnL3BhY2thZ2UuanNvbicpO1xuICAgICAgaWYgKHBhY2thZ2VKc29uQ29udGVudCkge1xuICAgICAgICBjb25zdCBwYWNrYWdlSnNvbiA9IEpTT04ucGFyc2UocGFja2FnZUpzb25Db250ZW50LnRvU3RyaW5nKCkpIGFzIHtcbiAgICAgICAgICBzY2hlbWF0aWNzOiB1bmtub3duO1xuICAgICAgICB9O1xuICAgICAgICBpZiAodHlwZW9mIHBhY2thZ2VKc29uLnNjaGVtYXRpY3MgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgY29uc3QgcCA9IG5vcm1hbGl6ZShwYWNrYWdlSnNvbi5zY2hlbWF0aWNzKTtcbiAgICAgICAgICBpZiAodHJlZS5leGlzdHMocCkpIHtcbiAgICAgICAgICAgIGNvbGxlY3Rpb25QYXRoID0gcDtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIHt9XG5cbiAgICBsZXQgc291cmNlID0gYXBwbHkodXJsKCcuL3NjaGVtYXRpYy1maWxlcycpLCBbXG4gICAgICB0ZW1wbGF0ZSh7XG4gICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgIGNvcmVWZXJzaW9uLFxuICAgICAgICBzY2hlbWF0aWNzVmVyc2lvbixcbiAgICAgICAgZG90OiAnLicsXG4gICAgICAgIGNhbWVsaXplOiBzdHJpbmdzLmNhbWVsaXplLFxuICAgICAgICBkYXNoZXJpemU6IHN0cmluZ3MuZGFzaGVyaXplLFxuICAgICAgfSksXG4gICAgXSk7XG5cbiAgICAvLyBTaW1wbHkgY3JlYXRlIGEgbmV3IHNjaGVtYXRpYyBwcm9qZWN0LlxuICAgIGlmICghY29sbGVjdGlvblBhdGgpIHtcbiAgICAgIGNvbGxlY3Rpb25QYXRoID0gbm9ybWFsaXplKCcvJyArIG9wdGlvbnMubmFtZSArICcvc3JjL2NvbGxlY3Rpb24uanNvbicpO1xuICAgICAgc291cmNlID0gYXBwbHkodXJsKCcuL3Byb2plY3QtZmlsZXMnKSwgW1xuICAgICAgICB0ZW1wbGF0ZSh7XG4gICAgICAgICAgLi4uKG9wdGlvbnMgYXMgb2JqZWN0KSxcbiAgICAgICAgICBjb3JlVmVyc2lvbixcbiAgICAgICAgICBzY2hlbWF0aWNzVmVyc2lvbixcbiAgICAgICAgICBkb3Q6ICcuJyxcbiAgICAgICAgICBjYW1lbGl6ZTogc3RyaW5ncy5jYW1lbGl6ZSxcbiAgICAgICAgICBkYXNoZXJpemU6IHN0cmluZ3MuZGFzaGVyaXplLFxuICAgICAgICB9KSxcbiAgICAgICAgbWVyZ2VXaXRoKHNvdXJjZSksXG4gICAgICAgIG1vdmUob3B0aW9ucy5uYW1lKSxcbiAgICAgIF0pO1xuXG4gICAgICBjb250ZXh0LmFkZFRhc2sobmV3IE5vZGVQYWNrYWdlSW5zdGFsbFRhc2sob3B0aW9ucy5uYW1lKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYWluKFtcbiAgICAgIG1lcmdlV2l0aChzb3VyY2UpLFxuICAgICAgYWRkU2NoZW1hdGljVG9Db2xsZWN0aW9uSnNvbihjb2xsZWN0aW9uUGF0aCwgc3RyaW5ncy5kYXNoZXJpemUob3B0aW9ucy5uYW1lKSwge1xuICAgICAgICBkZXNjcmlwdGlvbjogJ0EgYmxhbmsgc2NoZW1hdGljLicsXG4gICAgICAgIGZhY3Rvcnk6XG4gICAgICAgICAgJy4vJyArIHN0cmluZ3MuZGFzaGVyaXplKG9wdGlvbnMubmFtZSkgKyAnL2luZGV4IycgKyBzdHJpbmdzLmNhbWVsaXplKG9wdGlvbnMubmFtZSksXG4gICAgICB9KSxcbiAgICBdKTtcbiAgfTtcbn1cbiJdfQ==