"use client";

export default function UsersAreaShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">{children}</div>
  );
}
