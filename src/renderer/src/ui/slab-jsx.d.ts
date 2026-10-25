import type { DetailedHTMLProps, HTMLAttributes } from "react";

/** Attributes accepted by Slab elements; React 19 forwards them to the custom element. */
interface SlabAttributes {
  class?: string;
  label?: string;
  value?: string;
  type?: string;
  placeholder?: string;
  rows?: number;
  panel?: string;
  name?: string;
  placement?: "top" | "bottom" | "left" | "right";
  closedby?: "any" | "closerequest" | "none";
  duration?: number;
  max?: number;
  orientation?: "horizontal" | "vertical";
  "hide-label"?: boolean;
  "dismiss-label"?: string;
  disabled?: boolean;
  selected?: boolean;
  pressed?: boolean;
  dismissible?: boolean;
  multiple?: boolean;
  open?: boolean;
  expanded?: boolean;
}

type SlabElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & SlabAttributes;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "slab-alert": SlabElement;
      "slab-checkbox": SlabElement;
      "slab-dialog": SlabElement;
      "slab-disclosure": SlabElement;
      "slab-listbox": SlabElement;
      "slab-menu": SlabElement;
      "slab-menu-item": SlabElement;
      "slab-option": SlabElement;
      "slab-pagination": SlabElement;
      "slab-progress": SlabElement;
      "slab-select": SlabElement;
      "slab-tabs": SlabElement;
      "slab-tabs-panel": SlabElement;
      "slab-tabs-tab": SlabElement;
      "slab-text-field": SlabElement;
      "slab-textarea": SlabElement;
      "slab-toast": SlabElement;
      "slab-toggle-group": SlabElement;
      "slab-toggle-group-button": SlabElement;
      "slab-toolbar": SlabElement;
      "slab-tooltip": SlabElement;
      "slab-tree": SlabElement;
      "slab-tree-item": SlabElement;
    }
  }
}
