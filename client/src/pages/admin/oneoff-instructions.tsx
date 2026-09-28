import { BookOpen, Database, ShieldCheck, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageTitle } from "@/contexts/PageTitleContext";

const code = "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground";

export default function OneoffInstructionsPage() {
  usePageTitle("One-off Jobs · Instructions");

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-9">
      <header className="rounded-2xl border border-[#b8c9c3] bg-[#eaf1ee] px-5 py-7 md:px-9">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#54736a]">
          <BookOpen className="h-4 w-4" /> Developer guide
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#1b342d] md:text-4xl">
          Building a Oneoff plugin
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#50645e]">
          Oneoff plugins provide administrator-triggered operations with a preflight, an explicit
          confirmation, and a recorded run. Start with the working example in{" "}
          <code className={code}>server/plugins/system/oneoff/plugins/test.ts</code>.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">1. Define and register the plugin</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>
              Implement the <code className={code}>OneoffPlugin</code> contract in{" "}
              <code className={code}>server/plugins/system/oneoff/types.ts</code>. Supply stable
              metadata (including an id, name, and appropriate access policy), an{" "}
              <code className={code}>actions</code> list, and a{" "}
              <code className={code}>status</code> function returning{" "}
              <code className={code}>{"{ tableExists, rowCount }"}</code>.
            </p>
            <p>
              Give each action an id, label, <code className={code}>preflight</code>, and{" "}
              <code className={code}>execute</code>. Mark destructive operations with{" "}
              <code className={code}>destructive: true</code>; use{" "}
              <code className={code}>background: true</code> when applicable. Register with{" "}
              <code className={code}>registerOneoffPlugin</code> and load the plugin module from
              the Oneoff system initialization, as the test plugin does.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">2. Preflight before execution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>
              Validate input and current state in <code className={code}>preflight</code>.
              Return a clear <code className={code}>message</code> and, when useful,{" "}
              <code className={code}>rowCount</code> or{" "}
              <code className={code}>estimatedDurationMs</code>. Preflight may prepare a
              scratch table if needed, but should not perform the confirmed operation.
            </p>
            <p>
              The runner checks the destructive state after preflight and again at confirmation.
              A preflight alone does not start the action: the administrator reviews its result
              and confirms. Approvals expire after ten minutes, can be used once, and are bound
              to the administrator, configuration, action, and input.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">3. Report progress and honor cancellation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>
              <code className={code}>execute</code> receives an{" "}
              <code className={code}>AbortSignal</code> as{" "}
              <code className={code}>signal</code> and a{" "}
              <code className={code}>reportProgress</code> function. For longer jobs, check
              the signal between units of work and report a phase, completed and total counts,
              row count, and an optional checkpoint.
            </p>
            <p>
              Cancellation is cooperative: stop at a safe point rather than continuing writes.
              An interrupted or failed run may leave partial changes, so make retries and
              cleanup safe to inspect. The runner handles run history, heartbeat, and final
              status; plugins should not implement their own run tracking.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="h-4 w-4" /> Scratch tables
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>
              A Oneoff action may own a disposable table in the public schema such as{" "}
              <code className={code}>public.oneoff_test</code>. Unmodeled live tables whose
              names begin exactly with <code className={code}>oneoff_</code> are exempt from
              the startup check for extra tables. A bare <code className={code}>oneoff</code>{" "}
              table or a differently named scratch table is not exempt.
            </p>
            <p>
              This naming rule does not exempt modeled tables from schema checks and does not
              authorize changes to unrelated tables. Before destructive cleanup, check that
              the table exists and verify its expected schema and identity; the test plugin
              checks its table shape again immediately before dropping it.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-[#b8c9c3]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-[#42675a]" /> Database access: choose the right path
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 text-sm leading-6 text-muted-foreground md:grid-cols-2">
          <div className="space-y-3">
            <h2 className="font-semibold text-foreground">Runner-provided connection</h2>
            <p>
              The runner provides <code className={code}>context.db</code> to an action&apos;s{" "}
              <code className={code}>preflight</code> only when it declares{" "}
              <code className={code}>preflightDatabaseAccess: "read-write"</code>, and to{" "}
              <code className={code}>execute</code> only when it declares{" "}
              <code className={code}>executeDatabaseAccess: "read-write"</code>. These
              opt-ins are independent. The plugin&apos;s <code className={code}>status</code>{" "}
              callback also receives a database connection.
            </p>
            <p>
              Use this exceptional, storage-bypass capability for the Oneoff action&apos;s own
              scratch-table operations, such as creating or dropping its disposable table.
              Do not import a second direct database connection or use this capability as a
              shortcut for ordinary application data writes; those belong in storage methods.
            </p>
          </div>
          <div className="space-y-3">
            <h2 className="font-semibold text-foreground">Separate pure-read exception</h2>
            <p>
              The <code className={code}>needsReadOnlyDb: true</code> plugin metadata
              opt-in is a different exception: a plugin with one self-contained pure-read
              query may use <code className={code}>storage.readOnly.query</code>. It cannot
              mutate data and does not grant an action{" "}
              <code className={code}>context.db</code>. For normal application queries,
              add or use a method in <code className={code}>server/storage/</code>.
            </p>
            <div className="flex gap-2 rounded-lg border border-[#e3c49f] bg-[#fbf5eb] p-3 text-[#795c35]">
              <TriangleAlert className="mt-1 h-4 w-4 shrink-0" />
              <p>Declare only the database access each phase actually needs; never assume a preflight opt-in also grants access during execution.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}