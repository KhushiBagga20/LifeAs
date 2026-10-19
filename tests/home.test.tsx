// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Home from "@/app/page";
import { kindsOfWork } from "@/lib/kinds";

describe("Home", () => {
  afterEach(cleanup);

  it("states what the product does", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Live a week in a job before you choose it." }),
    ).toBeDefined();
  });

  it("lists all six kinds of work", () => {
    render(<Home />);
    for (const kind of kindsOfWork) {
      expect(screen.getByText(kind.name)).toBeDefined();
    }
  });
});
