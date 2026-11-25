import type { ReactNode } from "react";
import Header from "@/components/layout/Header";
import { HelpDisplay } from "@/components/HelpDisplay";
import Footer from "@/components/layout/Footer";

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <Header />
      <HelpDisplay />
      <main id="site-content" className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
