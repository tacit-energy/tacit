import { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type BadgeVariant = "default" | "secondary" | "destructive" | "warning" | "outline" | "success";

const variantClasses: Record<BadgeVariant, string> = {
  default: "badge badge-default",
  secondary: "badge badge-secondary",
  destructive: "badge badge-destructive",
  warning: "badge badge-warning",
  outline: "badge badge-outline",
  success: "badge badge-success",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: BadgeVariant }) {
  return <div className={cn(variantClasses[variant], className)} {...props} />;
}
