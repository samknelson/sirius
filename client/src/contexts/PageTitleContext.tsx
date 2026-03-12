import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { SiteSettings } from "@/lib/system-types";

interface PageTitleContextValue {
  setPageTitle: (title: string) => void;
}

const PageTitleContext = createContext<PageTitleContextValue | null>(null);

const DEFAULT_APP_NAME = "Sirius";

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string>("");
  
  const { data: settings } = useQuery<SiteSettings>({
    queryKey: ["/api/site-settings"],
  });
  
  const appName = settings?.siteTitle || DEFAULT_APP_NAME;

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
