import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";

import {
  AsyncButton,
  InlineError,
  ModalShell,
  SegmentedTabs,
  SessionSaveIndicator,
  SourceTag,
  StatusBadge,
  Toast,
} from "../../app/ui-primitives";

function InteractiveTabs() {
  const [value, setValue] = useState("library");
  return (
    <>
      <SegmentedTabs
        label="Program sources"
        panelId="program-source-panel"
        tabs={[
          { value: "library", label: "Library" },
          { value: "own", label: "Own", disabled: true },
          { value: "coach", label: "Coach", badge: 2 },
        ]}
        value={value}
        onChange={setValue}
      />
      <div
        id="program-source-panel"
        role="tabpanel"
        aria-labelledby={`program-source-panel-${value}-tab`}
      >
        {value} content
      </div>
    </>
  );
}

describe("SegmentedTabs", () => {
  it("uses one tab stop and changes selection with arrow, Home, and End keys", async () => {
    const user = userEvent.setup();
    render(<InteractiveTabs />);

    const library = screen.getByRole("tab", { name: "Library" });
    const own = screen.getByRole("tab", { name: "Own" });
    const coach = screen.getByRole("tab", { name: /Coach/ });

    expect(library).toHaveAttribute("tabindex", "0");
    expect(own).toBeDisabled();
    expect(coach).toHaveAttribute("tabindex", "-1");

    library.focus();
    await user.keyboard("{ArrowRight}");
    expect(coach).toHaveFocus();
    expect(coach).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("coach content");

    await user.keyboard("{Home}");
    expect(library).toHaveFocus();
    await user.keyboard("{End}");
    expect(coach).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(library).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(coach).toHaveFocus();
  });

  it("associates each tab with its panel and has no automated axe violations", async () => {
    const { container } = render(<InteractiveTabs />);

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("aria-controls", "program-source-panel");
    }
    const results = await axe(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});

describe("shared labels and async actions", () => {
  it("renders factual source and status text", () => {
    render(
      <>
        <SourceTag source={{ kind: "coach", creatorName: "Casey" }} />
        <StatusBadge status="in_progress" />
      </>,
    );

    expect(screen.getByText("Coach · Casey")).toHaveAttribute(
      "title",
      "Created by your coach, Casey",
    );
    expect(screen.getByText("In progress")).toBeVisible();
  });

  it("renders viewer-relative and unknown provenance without inventing Library", () => {
    render(
      <>
        <SourceTag
          presentation={{
            origin: "coach",
            tone: "coach",
            label: "Coach · You",
            title: "Assigned by you",
          }}
        />
        <SourceTag source={{ kind: "unknown" }} />
      </>,
    );

    expect(screen.getByText("Coach · You")).toHaveAttribute(
      "title",
      "Assigned by you",
    );
    expect(screen.getByText("Source unavailable")).toBeVisible();
  });

  it("disables a loading action and replaces its visible label", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <AsyncButton loading loadingLabel="Saving" onClick={onClick}>
        Save
      </AsyncButton>,
    );

    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("announces toast updates through a polite live region", () => {
    render(<Toast message="Workout saved" />);

    expect(screen.getByRole("status")).toHaveTextContent("Workout saved");
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
  });

  it("announces reusable inline errors assertively", () => {
    render(<InlineError>Saving failed</InlineError>);

    expect(screen.getByRole("alert")).toHaveTextContent("Saving failed");
  });

  it.each([
    ["saved", true, "Saved"],
    ["saving", true, "Saving…"],
    ["unsaved-offline", false, "Saved on this device · reconnect to sync"],
    ["error", true, "Saved on this device · sync needs attention"],
    ["saved", false, "Saved · reconnect to finish"],
  ] as const)("announces the %s workout save state", (status, online, label) => {
    render(<SessionSaveIndicator status={status} online={online} />);

    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("does not claim device recovery when browser storage is unavailable", () => {
    render(
      <SessionSaveIndicator
        status="unsaved-offline"
        online={false}
        localRecoveryAvailable={false}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Not saved yet · keep this page open and reconnect",
    );
  });
});

describe("ModalShell", () => {
  it("preserves editing focus across parent renders and respects the latest dismissal state", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function FormDialog() {
      const [name, setName] = useState("");
      const [description, setDescription] = useState("");
      const [saving, setSaving] = useState(false);
      return (
        <ModalShell title="Edit plan" description="Plan details" dismissible={!saving} onClose={() => onClose(description)}>
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <button type="button" onClick={() => setSaving((current) => !current)}>Toggle saving</button>
        </ModalShell>
      );
    }
    render(<FormDialog />);
    const description = screen.getByRole("textbox", { name: "Description" });
    await user.type(description, "Updated plan");
    expect(description).toHaveValue("Updated plan");
    expect(description).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Toggle saving" }));
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Toggle saving" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledWith("Updated plan");
  });

  it("contains forward and backward focus from the dialog and includes links", async () => {
    const user = userEvent.setup();
    render(
      <ModalShell title="Confirm action" description="Review first" onClose={vi.fn()}>
        <input type="hidden" />
        <button type="button" hidden>Hidden action</button>
        <div style={{ display: "none" }}><input aria-label="Hidden responsive field" /></div>
        <a href="#help">Help</a>
      </ModalShell>,
    );
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close" });
    const help = screen.getByRole("link", { name: "Help" });
    expect(dialog).toHaveFocus();
    await user.tab({ shift: true });
    expect(help).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(help).toHaveFocus();
  });

  it("only dismisses the topmost dialog on Escape", async () => {
    const user = userEvent.setup();
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    render(<>
      <ModalShell title="Outer" description="First dialog" onClose={closeOuter}>First</ModalShell>
      <ModalShell title="Inner" description="Second dialog" onClose={closeInner}>Second</ModalShell>
    </>);
    await user.keyboard("{Escape}");
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });

  it("labels the dialog, focuses the first field, closes on Escape, and restores focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <ModalShell
        title="Rename workout"
        description="Choose a new name"
        onClose={onClose}
      >
        <label>
          Name
          <input />
        </label>
      </ModalShell>,
    );

    expect(screen.getByRole("dialog", { name: "Rename workout" })).toHaveAttribute(
      "aria-describedby",
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
