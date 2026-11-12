import { Link } from "wouter";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { MessageDefaultsSettings } from "@/components/comm/MessageDefaultsSettings";

export default function EmailConfigPage() {
  usePageTitle("Email Settings");
  return (
    <div className="space-y-6">
      <h2 className="text-xl md:text-2xl font-bold" data-testid="heading-email-config">Email Configuration</h2>
      <p className="text-muted-foreground">
        Configure email delivery, default sender, credentials and operation assignments in{" "}
        <Link href="/admin/plugin-configs/wc-vendors" className="text-primary underline">Webclient vendor connections</Link>.
        {" "}Message branding below applies to every email connection.
      </p>
      <MessageDefaultsSettings channel="email" />
    </div>
  );
}
