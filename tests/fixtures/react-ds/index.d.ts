import * as React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual emphasis. */
  variant: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}
/** Primary action trigger. */
export declare const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>;

export declare function Card(props: { title: string; children?: React.ReactNode }): React.JSX.Element;

export declare class LegacyPanel extends React.Component<{ open: boolean }> {
  render(): React.ReactNode;
}

declare function DialogRoot(props: { open?: boolean; children?: React.ReactNode }): React.JSX.Element;
declare function DialogTitle(props: { children?: React.ReactNode }): React.JSX.Element;
export declare const Dialog: { Root: typeof DialogRoot; Title: typeof DialogTitle };

export declare function useToast(): { show(msg: string): void };
export declare const VERSION: string;
export type Tone = "neutral" | "brand";
export {};
