import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSecretOptionsToken,
  setSecretOptionsScope,
  setSecretOptionsToken,
} from "../../utils/secretOptionsAuth";
import SecretOptions from "../SecretOptions";

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}));

vi.mock("../../utils/apiUtils", async () => {
  const actual = await vi.importActual<typeof import("../../utils/apiUtils")>("../../utils/apiUtils");
  return {
    ...actual,
    apiFetch: apiFetchMock,
  };
});

const renderPage = () => render(
  <MemoryRouter>
    <SecretOptions />
  </MemoryRouter>,
);

const emptyReadWorkspaceResponse = (endpoint: string) => {
  if (endpoint === "/secret/options/access") {
    return Promise.resolve({ actor: "reader", scope: "read", auth_mode: "bearer", request_id: "req-1" });
  }
  if (endpoint.startsWith("/secret/options/positions")) {
    return Promise.resolve({ positions: [], metrics_cache: null });
  }
  if (endpoint === "/secret/options/position-row-context") {
    return Promise.resolve({ contexts_by_position: {} });
  }
  if (endpoint === "/secret/options/decision-review-windows") {
    return Promise.resolve({ windows_by_position: {} });
  }
  if (endpoint.startsWith("/secret/options/optionality-clusters")) {
    return Promise.resolve({ clusters: [] });
  }
  if (endpoint.startsWith("/secret/options/scanner-summary")) {
    return Promise.reject(new Error("Scanner summary is outside this auth test."));
  }
  return Promise.reject(new Error(`Unexpected Secret Options test endpoint: ${endpoint}`));
};

describe("Secret Options authorization gate", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    clearSecretOptionsToken();
    window.sessionStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    clearSecretOptionsToken();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("never renders the private workspace while an in-memory credential is being rejected", async () => {
    setSecretOptionsToken("stale-token");
    setSecretOptionsScope("write");
    apiFetchMock.mockRejectedValue(new Error("Unauthorized"));

    renderPage();

    expect(screen.getByText("Private workspace locked")).not.toBeNull();
    expect(screen.queryByText("Position summary")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Options workspaces" })).toBeNull();

    await waitFor(() => {
      expect(screen.getByText(/credential was rejected/i)).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    });
    expect(screen.queryByText(/session unlocked/i)).toBeNull();
  });

  it("keeps an invalid credential on the locked screen", async () => {
    apiFetchMock.mockRejectedValue(new Error("Unauthorized"));
    const user = userEvent.setup();
    renderPage();

    const credential = screen.getByLabelText("Bearer credential");
    await user.type(credential, "not-valid");
    await user.click(screen.getByRole("button", { name: "Unlock session" }));

    await waitFor(() => expect(screen.getByText(/credential was rejected/i)).not.toBeNull());
    expect(screen.getByText("Private workspace locked")).not.toBeNull();
    expect(screen.queryByText("Position summary")).toBeNull();
    expect(screen.queryByText(/session unlocked/i)).toBeNull();
  });

  it("does not let a successful background read close a write-credential prompt", async () => {
    setSecretOptionsToken("read-token");
    setSecretOptionsScope("read");
    let resolvePositions: ((value: unknown) => void) | undefined;
    const positionsPending = new Promise((resolve) => {
      resolvePositions = resolve;
    });
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint === "/secret/options/access") {
        return Promise.resolve({ actor: "reader", scope: "read", auth_mode: "bearer", request_id: "req-2" });
      }
      if (endpoint.startsWith("/secret/options/positions")) return positionsPending;
      return emptyReadWorkspaceResponse(endpoint);
    });
    const user = userEvent.setup();
    renderPage();

    const upgrade = await screen.findByRole("button", { name: "Use write credential" });
    await user.click(upgrade);
    expect(screen.getByText("Private workspace locked")).not.toBeNull();
    expect(screen.getByText(/Enter a write-scoped credential/i)).not.toBeNull();

    await act(async () => {
      resolvePositions?.({ positions: [], metrics_cache: null });
      await positionsPending;
    });

    await waitFor(() => expect(screen.getByText("Private workspace locked")).not.toBeNull());
    expect(screen.queryByText("Position summary")).toBeNull();
  });

  it("shows a mobile lock control and disables mutations for a read session", async () => {
    setSecretOptionsToken("read-token");
    setSecretOptionsScope("read");
    apiFetchMock.mockImplementation(emptyReadWorkspaceResponse);
    renderPage();

    const lock = await screen.findByRole("button", { name: "Lock Secret Options read access" });
    expect(lock).not.toBeNull();
    const add = screen.getByRole("button", { name: "Add" });
    expect(add.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/mutations are blocked before an API request is sent/i)).not.toBeNull();
  });
});
