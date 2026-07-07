import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useSiteSettings } from "@/lib/use-variable";

interface PageTitleContextValue {
  setPageTitle: (title: string) => void;
}

const PageTitleContext = createContext<PageTitleContextValue | null>(null);

const DEFAULT_APP_NAME = "Sirius";

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string>("");
  
  const settings = useSiteSettings();

  const appName = settings.siteTitle || DEFAULT_APP_NAME;

  useEffect(() => {
    if (title) {
      document.title = `${title} | ${appName}`;
    } else {
      document.title = appName;
    }
  }, [title, appName]);

  return (
    <PageTitleContext.Provider value={{ setPageTitle: setTitle }}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitle(title: string | undefined | null) {
  const context = useContext(PageTitleContext);
  
  useEffect(() => {
    if (context && title) {
      context.setPageTitle(title);
    }
  }, [context, title]);
}
