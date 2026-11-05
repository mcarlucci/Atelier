import * as React from "react";

export interface ButtonProps {
  /** Visual emphasis. */
  variant: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  children?: React.ReactNode;
}

/** Primary action trigger. */
export function Button({ variant, size = "md", children }: ButtonProps) {
  return <button className={`btn btn-${variant} btn-${size}`}>{children}</button>;
}
