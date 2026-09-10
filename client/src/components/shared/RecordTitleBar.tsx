import { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RecordMetadataBadge } from "@/components/shared/RecordMetadataBadge";

/**
 * The single title bar every record page renders.
 *
 * Entity layouts under client/src/components/layouts/ used to hand-roll this
 * markup three times each (not found / loading / the real record), so anything
 * that belongs on every record page cost a ~33 file sweep and could silently
 * land in the wrong copy. Add such a thing here instead, once.
 *
 * Three shapes are in use; they differ in chrome, not in vocabulary:
 *  - "bar":     full-width card header strip, 8x8 icon chip, small title.
 *               Owns its own <header> and page container.
 *  - "page":    hero block inside a page container the caller already opened
 *               (breadcrumb row + 12x12 icon chip + large title).
 *  - "compact": leading icon back button + bold title, rendered inside a
 *               <section> the caller already opened.
 */
export type RecordTitleBarVariant = "bar" | "page" | "compact";

export interface RecordTitleBarBackLink {
  href: string;
  /** Button text; the label of an icon-only back button. */
  label: string;
  /** Defaults to "button-back". */
  testId?: string;
  /**
   * "bar" only: render an icon-only button ahead of the title instead of a
   * labelled button on the right. Ignored by the other variants, which each
   * have exactly one place a back link goes.
   */
  placement?: "leading" | "trailing";
}

export interface RecordTitleBarProps {
  variant?: RecordTitleBarVariant;
  /** Icon element; the variant supplies the chip around it. */
  icon?: ReactNode;
  title: ReactNode;
  titleTestId?: string;
  /** Badges and inline controls rendered beside the title. */
  badges?: ReactNode;
  /** Line(s) under the title. */
  subtitle?: ReactNode;
  /** Right-hand slot, ahead of the back link and the record badge. */
  actions?: ReactNode;
  backLink?: RecordTitleBarBackLink;
  /** "page" only: the breadcrumb trail beside the back link. */
  breadcrumb?: ReactNode;
  /** Id of the record on show. Drives everything record-scoped in this bar. */
  recordId?: string | null;
}

function BackLinkButton({ link, iconOnly }: { link: RecordTitleBarBackLink; iconOnly: boolean }) {
  return (
    <Link href={link.href}>
      {iconOnly ? (
        <Button
          variant="ghost"
          size="icon"
          data-testid={link.testId ?? "button-back"}
          aria-label={link.label}
          title={link.label}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      ) : (
        <Button variant="ghost" size="sm" data-testid={link.testId ?? "button-back"}>
          <ArrowLeft size={16} className="mr-2" />
          {link.label}
        </Button>
      )}
    </Link>
  );
}

/** Everything record-scoped that every record page carries. */
function RecordExtras({ recordId }: { recordId?: string | null }) {
  if (!recordId) return null;
  return <RecordMetadataBadge entityId={recordId} />;
}

function TitleBlock({
  variant,
  title,
  titleTestId,
  badges,
  subtitle,
}: Pick<RecordTitleBarProps, "title" | "titleTestId" | "badges" | "subtitle"> & {
  variant: RecordTitleBarVariant;
}) {
  const titleClass =
    variant === "page"
      ? "text-3xl font-bold text-foreground"
      : variant === "compact"
        ? "text-xl md:text-2xl font-bold text-foreground"
        : "text-xl font-semibold text-foreground truncate";

  const heading = (
    <h1 className={titleClass} data-testid={titleTestId}>
      {title}
    </h1>
  );

  if (variant === "bar") {
    // The bar keeps badges as siblings of the title block so they line up with
    // the icon chip rather than with the subtitle.
    return (
      <>
        <div className="min-w-0">
          {heading}
          {subtitle}
        </div>
        {badges}
      </>
    );
  }

  return (
    <div className="flex-1 min-w-0">
      {badges ? (
        <div className="flex items-center gap-3 flex-wrap">
          {heading}
          {badges}
        </div>
      ) : (
        heading
      )}
      {subtitle}
    </div>
  );
}

export function RecordTitleBar({
  variant = "bar",
  icon,
  title,
  titleTestId,
  badges,
  subtitle,
  actions,
  backLink,
  breadcrumb,
  recordId,
}: RecordTitleBarProps) {
  const titleBlock = (
    <TitleBlock
      variant={variant}
      title={title}
      titleTestId={titleTestId}
      badges={badges}
      subtitle={subtitle}
    />
  );

  if (variant === "page") {
    return (
      <>
        {(breadcrumb || backLink) && (
          <div className="flex items-center justify-between mb-6">
            {breadcrumb ?? <div />}
            {backLink && <BackLinkButton link={backLink} iconOnly={false} />}
          </div>
        )}
        <div className="flex items-start gap-4 mb-6">
          {icon && (
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 shrink-0">
              {icon}
            </div>
          )}
          {titleBlock}
          {actions}
          <RecordExtras recordId={recordId} />
        </div>
      </>
    );
  }

  if (variant === "compact") {
    return (
      <div className="flex items-start gap-4">
        {backLink && <BackLinkButton link={backLink} iconOnly />}
        {icon}
        {titleBlock}
        {actions}
        <RecordExtras recordId={recordId} />
      </div>
    );
  }

  return (
    <header className="bg-card border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 gap-4">
          <div className="flex items-center space-x-3 min-w-0">
            {backLink?.placement === "leading" && <BackLinkButton link={backLink} iconOnly />}
            {icon && (
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shrink-0">
                {icon}
              </div>
            )}
            {titleBlock}
          </div>
          <div className="flex items-center space-x-4 shrink-0">
            {actions}
            {backLink && backLink.placement !== "leading" && (
              <BackLinkButton link={backLink} iconOnly={false} />
            )}
            <RecordExtras recordId={recordId} />
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * The title bar for a record that could not be loaded. Takes no record id: a
 * record that is not there has nothing record-scoped to show.
 */
export function RecordTitleBarNotFound({
  label,
  ...props
}: Omit<RecordTitleBarProps, "title" | "recordId" | "badges" | "subtitle" | "actions"> & {
  /** e.g. "Worker Not Found". */
  label: string;
}) {
  return <RecordTitleBar {...props} title={label} />;
}

/** The title bar while the record is still loading. */
export function RecordTitleBarLoading(
  props: Omit<RecordTitleBarProps, "title" | "recordId" | "badges" | "subtitle" | "actions">,
) {
  return <RecordTitleBar {...props} title={<Skeleton className="h-6 w-48" />} />;
}
