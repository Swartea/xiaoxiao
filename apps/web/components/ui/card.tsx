import { type PropsWithChildren } from "react";
import { cn } from "../utils";

export function Card({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn("rounded-xl border border-black/10 bg-white/80 p-4 shadow-sm", className)}>{children}</div>;
}
