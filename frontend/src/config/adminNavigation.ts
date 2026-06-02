import type { StoredUser } from "@/types/auth";

export type NavigationChildItem = {
  href: string;
  label: string;
  icon?: string;
};

export type NavigationItem = {
  href: string;
  icon: string;
  title: string;
  activePaths?: string[];
  children?: NavigationChildItem[];
  visible?: (user: StoredUser | null) => boolean;
};

export const MAIN_NAV_ITEMS: NavigationItem[] = [
  { href: "/projects", icon: "view_kanban", title: "Pipeline", activePaths: ["/projects"] },
  { href: "/messages", icon: "chat_bubble", title: "Messages" },
  { href: "/dashboard", icon: "dashboard", title: "Dashboard" },
  {
    href: "/clients",
    icon: "groups",
    title: "Clients",
    activePaths: ["/clients", "/clients/companies", "/clients/people", "/clients/opportunities"],
    children: [
      { href: "/clients/companies", label: "Companies", icon: "domain" },
      { href: "/clients/people", label: "People", icon: "person" },
      { href: "/clients/opportunities", label: "Opportunities", icon: "target" },
    ],
  },
  { href: "/proposals", icon: "request_quote", title: "Proposals" },
  { href: "/catalog", icon: "inventory_2", title: "Catalog" },
  { href: "/tasks", icon: "task", title: "Tasks" },
];

export const ADMIN_NAV_ITEMS: NavigationItem[] = [
  {
    href: "/users",
    icon: "group",
    title: "Users",
    activePaths: ["/users", "/admin/users", "/admin/user-types", "/admin/audit"],
    children: [
      { href: "/admin/users", label: "User Management", icon: "group" },
      { href: "/admin/user-types", label: "User Types", icon: "badge" },
      { href: "/admin/audit", label: "Audit Logs", icon: "policy" },
    ],
    visible: (user) =>
      !!(
        user?.user_type?.can_manage_users ||
        user?.user_type?.can_create_user_types ||
        user?.user_type?.can_view_audit_logs
      ),
  },
  {
    href: "/config",
    icon: "settings",
    title: "Config",
    activePaths: ["/config", "/admin/settings"],
    children: [
      { href: "/admin/settings?tab=general", label: "General", icon: "tune" },
      { href: "/admin/settings?tab=visual", label: "Visual Identity", icon: "palette" },
      { href: "/admin/settings?tab=ai", label: "AI Configuration", icon: "smart_toy" },
      { href: "/admin/settings?tab=quick-replies", label: "Quick Replies", icon: "quick_phrases" },
    ],
    visible: (user) => !!user?.user_type?.can_change_settings,
  },
];
