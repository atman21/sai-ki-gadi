import { AdminCommandPalette } from "@/components/admin/command-palette";
import { AdminTopHeader } from "@/components/admin/admin-top-header";

/**
 * Shared dashboard chrome for main dashboard and detail routes.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="admin-shell relative">
      <AdminTopHeader />
      <AdminCommandPalette />
      {children}
    </div>
  );
}
