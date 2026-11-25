#!/usr/bin/env npx tsx
import { generateOptionalComponents } from "./optional-components";
generateOptionalComponents();
await import("./schema/db-push");
