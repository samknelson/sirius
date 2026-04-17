import { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  title: string;
  icon?: ReactNode;
  backLink?: {
    href: string;
    label: string;
  };
  actions?: ReactNode;
}

export function PageHeader({ title, icon, backLink, actions }: PageHeaderProps) {
  return (
    <header className="bg-card border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-3">
            {icon && (
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                {icon}
              </div>
            )}
            <h1 className="text-base md:text-xl font-semibold text-foreground" data-testid="text-page-title">
              {title}
            </h1>
          </div>
          <div className="flex items-center space-x-4">
            {actions}
            {backLink && (
              <Link href={backLink.href}>
                <Button variant="ghost" size="sm" data-testid="button-back">
                  <ArrowLeft size={16} className="mr-2" />
                  {backLink.label}
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
