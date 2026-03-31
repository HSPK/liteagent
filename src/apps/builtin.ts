import { assistantAppDefinition } from './domain/assistant-app.js';
import { echoAppDefinition } from './domain/echo-app.js';
import { appManagerAppDefinition } from './system/app-manager-app.js';
import { plannerAppDefinition } from './system/planner-app.js';
import { routerAppDefinition } from './system/router-app.js';
import { todoAppDefinition } from './system/todo-app.js';
import { workflowAppDefinition } from './domain/workflow-app.js';
import type { AppDefinition, BuiltinAppTarget } from './types.js';

export const builtinAppDefinitions = [
  assistantAppDefinition,
  echoAppDefinition,
  appManagerAppDefinition,
  plannerAppDefinition,
  routerAppDefinition,
  todoAppDefinition,
  workflowAppDefinition,
  ] satisfies AppDefinition[];

export function registerBuiltinApps<T extends BuiltinAppTarget>(target: T): T {
  for (const definition of builtinAppDefinitions) {
    target.registerApp(definition);
  }

  return target;
}
