import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import type { ResolvedTab } from "@/hooks/useTabAccess";

interface EntityTabNavigationProps {
  tabs: ResolvedTab[];
  activeTab: string;
  activeRootId?: string;
  subTabs?: ResolvedTab[];
  appearance?: "buttons" | "underline";
  testIdPrefix: string;
  secondaryTestIdPrefix?: string;
  primaryTestId?: string;
  secondaryTestId?: string;
}

/**
 * The shared renderer for registry-backed record navigation.
 *
 * Layouts continue to own tab access, active-root resolution, and any
 * record-specific filtering. This component owns only the standard primary and
 * secondary navigation chrome.
 */
export function EntityTabNavigation({
  tabs,
  activeTab,
  activeRootId,
  subTabs,
  appearance = "buttons",
  testIdPrefix,
  secondaryTestIdPrefix,
  primaryTestId,
  secondaryTestId,
}: EntityTabNavigationProps) {
  const selectedRootId = activeRootId ?? activeTab;
  const primaryTabTestId = (tabId: string) => `${testIdPrefix}${tabId}`;
  const secondaryTabTestId = (tabId: string) =>
    `${secondaryTestIdPrefix ?? testIdPrefix}${tabId}`;

  if (appearance === "underline") {
    return (
      <>
        <div className="border-b border-border mb-2">
          <nav
            className="flex gap-6 flex-wrap"
            data-testid={primaryTestId}
            aria-label="Primary record navigation"
          >
            {tabs.map((tab) => {
              const isActive = tab.id === selectedRootId;
              return (
                <Link
                  key={tab.id}
                  href={tab.href}
                  className={`pb-3 border-b-2 transition-colors flex items-center gap-2 ${
                    isActive
                      ? "border-primary text-primary font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                  data-testid={primaryTabTestId(tab.id)}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {subTabs && subTabs.length > 0 && (
          <div className="border-b border-border mb-6 bg-muted/30 -mx-1 px-1">
            <nav
              className="flex gap-4 flex-wrap py-2 pl-2"
              data-testid={secondaryTestId}
              aria-label="Secondary record navigation"
            >
              {subTabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                  <Link
                    key={tab.id}
                    href={tab.href}
                    className={`text-sm transition-colors ${
                      isActive
                        ? "text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                    data-testid={secondaryTabTestId(tab.id)}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav
            className="flex flex-wrap items-center gap-2 py-3"
            data-testid={primaryTestId}
            aria-label="Primary record navigation"
          >
            {tabs.map((tab) =>
              tab.id === selectedRootId ? (
                <Button key={tab.id} variant="default" size="sm" asChild>
                  <span
                    aria-current="page"
                    data-testid={primaryTabTestId(tab.id)}
                  >
                    {tab.label}
                  </span>
                </Button>
              ) : (
                <Button key={tab.id} variant="outline" size="sm" asChild>
                  <Link
                    href={tab.href}
                    data-testid={primaryTabTestId(tab.id)}
                  >
                    {tab.label}
                  </Link>
                </Button>
              ),
            )}
          </nav>
        </div>
      </div>

      {subTabs && subTabs.length > 0 && (
        <div className="bg-muted/30 border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav
              className="flex flex-wrap items-center gap-2 py-2 pl-4"
              data-testid={secondaryTestId}
              aria-label="Secondary record navigation"
            >
              {subTabs.map((tab) =>
                tab.id === activeTab ? (
                  <Button key={tab.id} variant="secondary" size="sm" asChild>
                    <span
                      aria-current="page"
                      data-testid={secondaryTabTestId(tab.id)}
                    >
                      {tab.label}
                    </span>
                  </Button>
                ) : (
                  <Button key={tab.id} variant="ghost" size="sm" asChild>
                    <Link
                      href={tab.href}
                      data-testid={secondaryTabTestId(tab.id)}
                    >
                      {tab.label}
                    </Link>
                  </Button>
                ),
              )}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}