// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("Home", () => {
  afterEach(cleanup);
  it("introduces the embodied profession simulator", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1, name: /Step into it/ })).toBeDefined();
    expect(screen.getByRole("link", { name: "Enter the studio" }).getAttribute("href")).toBe("/play");
  });
  it("explains local versus AI character behaviour", () => {
    render(<Home />);
    expect(screen.getByText(/Connect an AI provider/)).toBeDefined();
  });
});
