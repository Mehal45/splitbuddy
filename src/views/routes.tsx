import * as React from "react";
import type { Role } from "@/lib/types";
import { SettingsView, TallyView } from "./admin";
import { ApprovalsView } from "./approvals";
import { CustomerDetail, CustomersView } from "./customers";
import { DriverHistoryView, DriverHome, NewDeliveryView } from "./driver";
import { InvoiceView, PurchasesView, SalesView } from "./invoices";
import { LoadSheetsView } from "./loads";
import { AlertsView, FleetView, OwnerDashboard } from "./owner";
import { ReconciliationView } from "./reconciliation";
import { ReportsView } from "./reports";
import { ActivityView } from "./activity";
import { MovementsView, StockView } from "./stock";
import { WarehouseHome } from "./warehouse-home";
import { useStore } from "@/lib/store";

export interface RouteDef {
  pattern: string;
  roles: Role[];
  render: (params: Record<string, string>, role: Role) => React.ReactNode;
}

const OW: Role[] = ["owner", "warehouse"];

// The customer portal only ever shows the logged-in customer's own data.
function MyAccount({ tab }: { tab?: string }) {
  const { user } = useStore();
  return <CustomerDetail id={user!.customerId!} portal tab={tab} />;
}

function Home({ role }: { role: Role }) {
  if (role === "owner") return <OwnerDashboard />;
  if (role === "warehouse") return <WarehouseHome />;
  if (role === "driver") return <DriverHome />;
  return <MyAccount />;
}

export const ROUTES: RouteDef[] = [
  { pattern: "/", roles: ["owner", "warehouse", "driver", "customer"], render: (_, role) => <Home role={role} /> },
  { pattern: "/alerts", roles: ["owner"], render: () => <AlertsView /> },
  { pattern: "/loads", roles: OW, render: () => <LoadSheetsView /> },
  { pattern: "/approvals", roles: OW, render: () => <ApprovalsView /> },
  { pattern: "/reconciliation", roles: OW, render: () => <ReconciliationView /> },
  { pattern: "/purchases", roles: OW, render: () => <PurchasesView /> },
  { pattern: "/sales", roles: ["owner"], render: () => <SalesView /> },
  { pattern: "/invoices/:id", roles: ["owner", "warehouse", "customer"], render: (p) => <InvoiceView id={p.id} /> },
  { pattern: "/stock", roles: OW, render: () => <StockView /> },
  { pattern: "/movements", roles: OW, render: () => <MovementsView /> },
  { pattern: "/customers", roles: OW, render: () => <CustomersView /> },
  { pattern: "/customers/:id", roles: OW, render: (p) => <CustomerDetail id={p.id} /> },
  { pattern: "/fleet", roles: ["owner"], render: () => <FleetView /> },
  { pattern: "/reports", roles: ["owner"], render: () => <ReportsView /> },
  { pattern: "/tally", roles: ["owner"], render: () => <TallyView /> },
  { pattern: "/settings", roles: ["owner"], render: () => <SettingsView /> },
  { pattern: "/activity", roles: ["owner"], render: () => <ActivityView /> },
  { pattern: "/driver/new", roles: ["driver"], render: () => <NewDeliveryView /> },
  { pattern: "/driver/history", roles: ["driver"], render: () => <DriverHistoryView /> },
  { pattern: "/me/deliveries", roles: ["customer"], render: () => <MyAccount tab="deliveries" /> },
  { pattern: "/me/invoices", roles: ["customer"], render: () => <MyAccount tab="invoices" /> },
  { pattern: "/me/payments", roles: ["customer"], render: () => <MyAccount tab="payments" /> },
];
