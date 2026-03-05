import { type ButtonHTMLAttributes } from "react";
import { cn } from "../utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "ghost";
};

export function Button({ className, variant = "default", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition",
        variant === "default" && "bg-ink text-paper hover:opacity-90",
        variant === "secondary" && "bg-ember text-white hover:bg-orange-500",
        variant === "ghost" && "bg-transparent text-ink hover:bg-black/5",
        className,
      )}
      {...props}
    />
  );
}
