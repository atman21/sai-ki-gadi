import { AdminCommandPalette } from "@/components/admin/command-palette";
import { AdminTopHeader } from "@/components/admin/admin-top-header";
import { AdminAccessProvider } from "@/components/admin/admin-access-provider";

/**
 * Shared dashboard chrome for main dashboard and detail routes.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminAccessProvider>
      <div className="admin-shell relative">
        <AdminTopHeader />
        <AdminCommandPalette />
        {children}
      </div>
    </AdminAccessProvider>
  );
}
