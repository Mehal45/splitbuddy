import type { Role } from "./types";

// Each group signs in on its own page; the root page is the owner's (PIN protected).
export const LOGIN_PATH: Record<Role, string> = { owner: "/", warehouse: "/staff", driver: "/driver", customer: "/customer" };
export const LOGIN_PAGES = ["/staff", "/driver", "/customer"];
