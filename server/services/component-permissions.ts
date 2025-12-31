import { componentRegistry, ComponentDefinition } from "../../shared/components";
import { permissionRegistry, PermissionDefinition } from "../../shared/permissions";
import { isComponentEnabledSync } from "./component-cache";
import { logger } from "../logger";

export function syncComponentPermissions(): void {
  const enabledComponents = componentRegistry.filter(component => 
    isComponentEnabledSync(component.id) && component.permissions && component.permissions.length > 0
  );

  let registeredCount = 0;

  for (const component of enabledComponents) {
    for (const permission of component.permissions!) {
      if (!permissionRegistry.exists(permission.key)) {
        const permDef: PermissionDefinition = {
          key: permission.key,
          description: permission.description,
          module: component.id
        };
        permissionRegistry.register(permDef);
        registeredCount++;
        logger.debug(`Registered permission from component`, { 
          service: "component-permissions",
          permissionKey: permission.key, 
          componentId: component.id 
        });
      }
    }
  }

  if (registeredCount > 0) {
    logger.info(`Component permissions registered`, { 
      service: "component-permissions",
      count: registeredCount 
    });
  }
}

export function getComponentsWithPermissions(): ComponentDefinition[] {
  return componentRegistry.filter(c => c.permissions && c.permissions.length > 0);
}
