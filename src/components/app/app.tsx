"use client";

import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/app/shell";
import { EmptyState } from "@/components/app/common";
import { match, usePath } from "@/lib/router";
import { StoreProvider, useStore } from "@/lib/store";
import type { Role } from "@/lib/types";
import { LoginView } from "@/views/login";
import { ROUTES } from "@/views/routes";

function Router() {
  const path = usePath();
  const { user, role } = useStore();
  if (!user || !role) return <LoginView />;

  let content: React.ReactNode = null;
  for (const r of ROUTES) {
    const params = match(r.pattern, path);
    if (!params) continue;
    content = r.roles.includes(role as Role) ? r.render(params, role) : (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
        <ShieldAlert className="size-10" />
        <p className="font-medium text-foreground">This page isn&apos;t available for your role.</p>
      </div>
    );
    break;
  }
  return <AppShell path={path}>{content ?? <EmptyState title="Page not found" hint="Use the menu to find what you need." />}</AppShell>;
}

export function App() {
  return (
    <StoreProvider>
      <Router />
      <Toaster richColors position="top-center" />
    </StoreProvider>
  );
}
