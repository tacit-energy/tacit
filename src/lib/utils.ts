import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatNumber(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits,
  }).format(value);
}

export function formatHour(timestamp: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

export function formatDay(timestamp: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}
