import type { NavigationItem } from "@/config/adminNavigation";

export function isPathActive(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function isItemActive(pathname: string, item: NavigationItem) {
  const paths = item.activePaths ?? [item.href];
  return paths.some((path) => isPathActive(pathname, path));
}

export function getInitialExpandedGroups(
  items: NavigationItem[],
  pathname: string,
): Record<string, boolean> {
  return items.reduce<Record<string, boolean>>((expanded, item) => {
    if (!item.children?.length) {
      return expanded;
    }

    expanded[item.href] = isItemActive(pathname, item);
    return expanded;
  }, {});
}
