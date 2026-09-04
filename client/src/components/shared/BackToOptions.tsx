import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

/** Where every dropdown list's page links back to: the index of all the lists. */
export const OPTIONS_INDEX_PATH = "/config/options";

/**
 * The title a page administering one dropdown list goes by. The registry
 * stores the list's name ("Grievance Step"); the word "Options" is added here,
 * at the point of display, so it never becomes part of a stored name again.
 */
export function optionsPageTitle(name: string): string {
  return `Options: ${name}`;
}

/**
 * The way back to the list of lists. Every page the options index sends a user
 * to shows this, including the four lists administered on their own page.
 */
export function BackToOptions() {
  return (
    <Link href={OPTIONS_INDEX_PATH}>
      <Button variant="ghost" size="sm" data-testid="button-back-to-options">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Options
      </Button>
    </Link>
  );
}
