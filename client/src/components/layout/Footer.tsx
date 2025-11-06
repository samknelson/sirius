import { useQuery } from "@tanstack/react-query";
import DOMPurify from "isomorphic-dompurify";

interface SiteSettings {
  siteName: string;
  footer: string;
}

export default function Footer() {
  const { data: settings } = useQuery<SiteSettings>({
    queryKey: ["/api/site-settings"],
  });

  if (!settings?.footer) {
    return null;
  }

  const sanitizedFooter = DOMPurify.sanitize(settings.footer);

  return (
    <footer 
      className="bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 mt-auto"
      data-testid="site-footer"
    >
      <div className="container mx-auto px-6 py-4">
        <div 
          className="text-sm text-gray-600 dark:text-gray-400 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: sanitizedFooter }}
        />
      </div>
    </footer>
  );
}
