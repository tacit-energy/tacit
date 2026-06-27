import { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("tabs-list", className)}>{children}</div>;
}

export function TabsTrigger({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={cn("tabs-trigger", active && "tabs-trigger-active")} onClick={onClick}>
      {children}
    </button>
  );
}
