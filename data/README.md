# Demo Quickstart

This directory contains the demo data snapshot for quickly resetting the database to a known demo state.

## Overview

The demo quickstart feature allows you to:
1. Capture the current database state as a snapshot
2. Reset the database to the snapshot state at any time

This is useful for:
- Resetting the database after testing
- Onboarding new team members with consistent demo data
- Preparing for demos or presentations

## Commands

### Capture a Snapshot

To capture the current database state:

```bash
npm run demo:snapshot
```

This exports the following tables to `data/demo-snapshot.json`:
- Options tables (gender, employer type, employment status, worker WS, dispatch job types)
- Contacts and phone numbers
- Employers and workers
- Worker hours and dispatch status
- Dispatch jobs and dispatches

### Reset to Snapshot

To reset the database to the snapshot state:

```bash
npm run demo:reset
```

You will be prompted to confirm the reset. To skip confirmation (useful for automation):

```bash
npm run demo:reset -- --force
```

## Safety Features

- **Environment Check**: Both commands refuse to run in production (`NODE_ENV=production`)
- **Confirmation Prompt**: The reset command requires explicit confirmation
- **Dependency Order**: Tables are cleared and restored in the correct order to respect foreign key constraints
- **Serial Sequence Reset**: Auto-increment sequences are reset after restore

## Updating the Snapshot

To update the snapshot with new demo data:

1. Make your changes to the database using the application
2. Run `npm run demo:snapshot` to capture the new state
3. Commit the updated `data/demo-snapshot.json` to version control

## File Structure

```
data/
  README.md           # This file
  demo-snapshot.json  # The demo data snapshot (auto-generated)
```

## Troubleshooting

### "Snapshot file not found"
Run `npm run demo:snapshot` first to create the initial snapshot.

### "Cannot run in production"
These commands are blocked in production environments for safety. Set `NODE_ENV` to something other than `production`.

### Foreign key constraint errors
Ensure you're running the latest database schema with `npm run db:push` before resetting.
