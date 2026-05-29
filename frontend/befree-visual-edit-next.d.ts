declare module "befree-visual-edit/next" {
  import type { NextConfig } from "next";

  export function withVisualEdit<T extends NextConfig>(config: T): T;
}
