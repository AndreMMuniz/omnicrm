"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { ADMIN_NAV_ITEMS, MAIN_NAV_ITEMS, type NavigationChildItem, type NavigationItem } from "@/config/adminNavigation";

function isPathActive(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isChildActive(currentRoute: string, childHref: string) {
  return currentRoute === childHref;
}

function isItemActive(pathname: string, item: NavigationItem) {
  const paths = item.activePaths ?? [item.href];
  return paths.some((path) => isPathActive(pathname, path));
}

export default function SideNavBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, logout } = useAuth();
  const search = searchParams.toString();
  const currentRoute = pathname === "/admin/settings" && !search
    ? "/admin/settings?tab=general"
    : search
      ? `${pathname}?${search}`
      : pathname;

  const visibleAdminItems = ADMIN_NAV_ITEMS.filter((item) => item.visible?.(user) ?? true);

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const renderChildItem = (child: NavigationChildItem) => {
    const active = isChildActive(currentRoute, child.href);

    return (
      <Link
        key={child.href}
        href={child.href}
        className={`flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
          active
            ? "bg-indigo-50 text-indigo-700"
            : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
        }`}
      >
        <span className="material-symbols-outlined text-[18px]">{child.icon ?? "chevron_right"}</span>
        <span className="font-medium">{child.label}</span>
      </Link>
    );
  };

  const renderItem = (item: NavigationItem) => {
    const active = isItemActive(pathname, item);
    const showChildren = active && item.children && item.children.length > 0;

    return (
      <div key={item.href} className="w-full">
        <Link
          href={item.href}
          title={item.title}
          className={`relative flex min-h-12 items-center gap-3 rounded-2xl px-3 py-3 transition-colors ${
            active
              ? "bg-indigo-50 text-indigo-700"
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
          }`}
        >
          {active && <span className="absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-indigo-600" />}
          <span
            className="material-symbols-outlined text-[22px]"
            style={active ? { fontVariationSettings: "'FILL' 1" } : {}}
          >
            {item.icon}
          </span>
          <span className="min-w-0 flex-1 text-sm font-semibold">{item.title}</span>
          {item.children && item.children.length > 0 && (
            <span className="material-symbols-outlined text-[18px] text-slate-400">
              expand_more
            </span>
          )}
        </Link>

        {showChildren && (
          <div className="mt-2 space-y-1 border-l border-slate-200 pl-4 ml-5">
            {item.children?.map(renderChildItem)}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav className="hidden h-full w-[272px] shrink-0 flex-col border-r border-[#E9ECEF] bg-white md:flex">
      <div className="border-b border-[#E9ECEF] px-4 py-4">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-2xl bg-indigo-600 px-3 py-3 text-white shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/15">
            <Image
              src="/icon.svg"
              alt="omnicrm.chat"
              width={32}
              height={32}
              className="h-8 w-8"
              priority
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none">omnicrm.chat</p>
            <p className="mt-1 text-xs text-indigo-100">Workspace navigation</p>
          </div>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-6">
          <div className="space-y-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Workspace</p>
            <div className="mt-2 space-y-1">
              {MAIN_NAV_ITEMS.map(renderItem)}
            </div>
          </div>

          {visibleAdminItems.length > 0 && (
            <div className="space-y-1">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Administration</p>
              <div className="mt-2 space-y-1">
                {visibleAdminItems.map(renderItem)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[#E9ECEF] p-3">
        <button
          onClick={handleLogout}
          title="Sign out"
          className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-3 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-500"
        >
          <span className="material-symbols-outlined text-[22px]">logout</span>
          <span className="text-sm font-semibold">Sign out</span>
        </button>
      </div>
    </nav>
  );
}
