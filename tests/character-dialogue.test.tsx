// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterDialogue } from "@/components/character-dialogue";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const props = () => ({ agent: "maya" as const, line: "Start with the audience.", busy: false, mode: "local" as const, onSend: vi.fn(), onClose: vi.fn(), onSpeaking: vi.fn() });

describe("character conversation", () => {
  it("reveals speech, allows skipping, and keeps the full line accessible", () => {
    const input = props();
    const view = render(<CharacterDialogue {...input} />);
    expect(screen.getByText(input.line)).toBeDefined();
    expect(input.onSpeaking).toHaveBeenCalledWith("maya", true);
    act(() => vi.advanceTimersByTime(66));
    expect(view.container.querySelector(".character-line-visible")?.textContent).toBe("Sta");
    fireEvent.click(screen.getByRole("button", { name: /Show full line/ }));
    act(() => vi.advanceTimersByTime(1000));
    expect(view.container.querySelector(".character-line-visible")?.textContent).toBe(input.line);
    expect(input.onSpeaking).toHaveBeenLastCalledWith("maya", false);
    expect(screen.queryByRole("button", { name: /Show full line/ })).toBeNull();
    view.rerender(<CharacterDialogue {...input} line="Now let’s look at the draft." />);
    act(() => vi.advanceTimersByTime(22));
    expect(view.container.querySelector(".character-line-visible")?.textContent).toBe("N");
  });
  it("submits suggestions and free-text replies and blocks duplicate input while busy", () => {
    const input = props();
    const view = render(<CharacterDialogue {...input} />);
    fireEvent.click(screen.getByRole("button", { name: /What should stand out first/ }));
    expect(input.onSend).toHaveBeenCalledWith("What should stand out first?");
    fireEvent.change(screen.getByRole("textbox", { name: "Your reply to Maya" }), { target: { value: "  Is the date readable?  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect(input.onSend).toHaveBeenLastCalledWith("Is the date readable?");
    view.rerender(<CharacterDialogue {...input} busy />);
    expect((screen.getByRole("button", { name: /What should stand out first/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Leave conversation" }));
    expect(input.onClose).toHaveBeenCalledOnce();
  });
  it("shows the complete line without a typing animation for reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const input = props();
    const view = render(<CharacterDialogue {...input} />);
    act(() => vi.advanceTimersByTime(1));
    expect(view.container.querySelector(".character-line-visible")?.textContent).toBe(input.line);
    expect(input.onSpeaking).toHaveBeenLastCalledWith("maya", false);
  });
});
