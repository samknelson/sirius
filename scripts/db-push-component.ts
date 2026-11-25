#!/usr/bin/env npx tsx
import { generateComponentPackages } from "./component-packages";
generateComponentPackages();
await import("./schema/db-push-component");
