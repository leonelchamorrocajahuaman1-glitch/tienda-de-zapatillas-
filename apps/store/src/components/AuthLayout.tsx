import type { ReactNode } from "react";
import { STORE_NAME } from "../lib/api";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth__art" aria-hidden>
        <span className="eyebrow eyebrow--accent">Members only</span>
        <div className="display">
          <span className="glitch" data-text={STORE_NAME}>
            {STORE_NAME}
          </span>
        </div>
      </div>
      <div className="auth__form">
        <div className="auth__box">{children}</div>
      </div>
    </div>
  );
}
