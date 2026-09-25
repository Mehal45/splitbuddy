import * as React from "react";
import type { Role } from "@/lib/types";

export interface RouteDef {
  pattern: string;
  roles: Role[];
  render: (params: Record<string, string>, role: Role) => React.ReactNode;
}

const Todo = ({ name }: { name: string }) => <div className="text-muted-foreground">{name} – coming next</div>;

export const ROUTES: RouteDef[] = [
  { pattern: "/", roles: ["owner", "warehouse", "driver", "customer"], render: (_, role) => <Todo name={`${role} home`} /> },
];
