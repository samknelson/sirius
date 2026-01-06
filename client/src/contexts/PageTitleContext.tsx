import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface PageTitleContextValue {
  setPageTitle: (title: string) => void;
}

const PageTitleContext = createContext<PageTitleContextValue | null>(null);

const APP_NAME = "Sirius";

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string>("");

  useEffect(() => {
    if (title) {
      document.title = `${title} | ${APP_NAME}`;
    } else {
      document.title = APP_NAME;
    }
  }, [title]);

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
