import * as i0 from "@angular/core";
/** A button. */
export declare class AcmeButtonComponent {
  variant: "primary" | "secondary";
  disabled: boolean;
  size: i0.InputSignal<"sm" | "lg">;
  pressed: i0.EventEmitter<void>;
  static ɵfac: i0.ɵɵFactoryDeclaration<AcmeButtonComponent, never>;
  static ɵcmp: i0.ɵɵComponentDeclaration<AcmeButtonComponent, "acme-button", never, { "variant": { "alias": "variant"; "required": true; }; "disabled": { "alias": "disabled"; "required": false; }; "size": { "alias": "size"; "required": false; "isSignal": true; }; }, { "pressed": "pressed"; }, never, ["*"], true, never>;
}
export declare class AcmeCardComponent {
  heading: string;
  static ɵcmp: i0.ɵɵComponentDeclaration<AcmeCardComponent, "acme-card", never, { "heading": "title"; }, {}, never, ["*"], false, never>;
}
export declare class AcmeCardModule {
  static ɵmod: i0.ɵɵNgModuleDeclaration<AcmeCardModule, [typeof AcmeCardComponent], never, [typeof AcmeCardComponent]>;
}
export declare class SomeService {}
