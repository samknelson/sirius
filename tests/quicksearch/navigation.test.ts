import { describe, expect, it, vi } from "vitest";

import { navigateQuicksearchResult } from "../../client/src/components/layout/QuickSearch";

describe("quicksearch result navigation", () => {
  it("uses full-page navigation for server-resolved record links", () => {
    const navigate = vi.fn();
    const fullNavigate = vi.fn();

    navigateQuicksearchResult("/go/000.0123%3A%3A0004", navigate, fullNavigate);

    expect(fullNavigate).toHaveBeenCalledWith("/go/000.0123%3A%3A0004");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps ordinary application links in the SPA", () => {
    const navigate = vi.fn();
    const fullNavigate = vi.fn();

    navigateQuicksearchResult("/workers/42", navigate, fullNavigate);

    expect(navigate).toHaveBeenCalledWith("/workers/42");
    expect(fullNavigate).not.toHaveBeenCalled();
  });

  it("keeps the standalone /go form in the SPA", () => {
    const navigate = vi.fn();
    const fullNavigate = vi.fn();

    navigateQuicksearchResult("/go", navigate, fullNavigate);

    expect(navigate).toHaveBeenCalledWith("/go");
    expect(fullNavigate).not.toHaveBeenCalled();
  });
});