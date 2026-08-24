import { ChevronDown, FlaskConical, X } from "lucide-react";
import { useState } from "react";
import personas from "virtual:liftlog-test-personas";
import { InlineError } from "./ui-primitives";

export interface TestPersonaChoice {
  key: string;
  name: string;
  email: string;
  scenario: string;
}

interface TestPersonaSwitcherProps {
  variant: "inline" | "dialog";
  password: string;
  currentEmail?: string;
  busyKey: string;
  error: string;
  onPassword: (password: string) => void;
  onSelect: (persona: TestPersonaChoice) => void;
  onClose?: () => void;
  onSignOut?: () => void;
}

function PersonaContent({ password, currentEmail, busyKey, error, onPassword, onSelect }: Omit<TestPersonaSwitcherProps, "variant" | "onClose">) {
  return <>
    <label className="test-password-field">
      <span>Shared QA password</span>
      <input
        type="password"
        value={password}
        onChange={(event) => onPassword(event.target.value)}
        autoComplete="off"
        placeholder="Enter once, then choose an account"
      />
      <small>Kept only in memory until this page is reloaded.</small>
    </label>
    <div className="test-persona-grid">
      {personas.map((persona) => {
        const current = currentEmail?.toLowerCase() === persona.email.toLowerCase();
        const busy = busyKey === persona.key;
        return <button
          type="button"
          key={persona.key}
          className={current ? "current" : ""}
          disabled={!password || Boolean(busyKey) || current}
          onClick={() => onSelect(persona)}
        >
          <span className="test-persona-avatar">{persona.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span>
          <span><strong>{persona.name}</strong><small>{persona.scenario}</small></span>
          <em>{current ? "Current" : busy ? "Opening…" : "TEST"}</em>
        </button>;
      })}
    </div>
    {error && <InlineError>{error}</InlineError>}
  </>;
}

export default function TestPersonaSwitcher(props: TestPersonaSwitcherProps) {
  const [expanded, setExpanded] = useState(false);
  if (props.variant === "inline") {
    return <section className="test-login-panel">
      <button className="test-login-toggle" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span><FlaskConical size={16} /><span><strong>Test population</strong><small>Development only</small></span></span>
        <ChevronDown size={16} className={expanded ? "rotated" : ""} />
      </button>
      {expanded && <div className="test-login-content"><PersonaContent {...props} /></div>}
    </section>;
  }

  return <div className="test-switcher-backdrop" role="presentation">
    <button className="modal-dismiss-layer" onClick={props.onClose} aria-label="Close test account switcher" />
    <section className="test-switcher-dialog" role="dialog" aria-modal="true" aria-labelledby="test-switcher-title">
      <header>
        <span className="auth-card-icon"><FlaskConical size={21} /></span>
        <div><p className="eyebrow">Development only</p><h2 id="test-switcher-title">Switch test account</h2><p>Use a real development session with isolated fictional data.</p></div>
        <button className="icon-button" onClick={props.onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <PersonaContent {...props} />
      {props.onSignOut && <footer className="test-switcher-footer"><span>Want to use your own development account?</span><button className="button secondary" onClick={props.onSignOut}>Sign out to Google login</button></footer>}
    </section>
  </div>;
}
