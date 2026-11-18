import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { ClaimActivity } from "./ClaimActivity";
import type { Claim } from "./api";
import { Records } from "./Records";

const base: Claim = {
  claim_id: "CLM-1001",
  thread_id: "thread-1",
  summary: "Flight delayed",
  claim_type: "trip_delay",
  amount_claimed: 420,
  status: "waiting",
  active: false,
  story: "My flight was canceled.",
  incident_date: "2026-06-18",
  incident_location: "Rome",
  submitted_on: "2026-06-24",
  customer: {
    name: "Maya Patel",
    previous_claims: [{ summary: "Prior claim", amount_paid: 140 }],
  },
  policy: {
    travelers: ["Maya Patel"],
    trip: { destination: "Rome", trip_cost: 3100 },
    active: true,
  },
  plan: { name: "Premium", deductible: 50 },
  add_ons: [],
  items: [{ description: "Hotel", amount: 420, category: "accommodation" }],
  documents: [
    { name: "Hotel receipt", type: "receipt", content: "Total $420" },
  ],
  decision: null,
  payment: null,
  sign_off: null,
  progress: [],
};
const approved = {
  outcome: "approve",
  amount: "1250.00",
  calculation: "Eligible costs.",
  reason: "Covered loss. Documents confirm it.",
  policy_section: "3",
};

function setup(changes: Partial<Claim> = {}, hash = "#CLM-1001") {
  window.location.hash = hash;
  const claim = { ...base, ...changes };
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    let body: unknown = claim;
    if (url.endsWith("/handlers"))
      body = [
        { handler_id: "HND-01", name: "Dana", can_approve_over_limit: true },
      ];
    if (url.endsWith("/instructions"))
      body = { text: "Decide using the full policy wording." };
    if (url.endsWith("/claims")) body = [claim];
    if (options) {
      claim.status = "decided";
      claim.active = false;
      body = {};
    }
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<App />);
  return fetcher;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("shows the queue and navigates to full claim details", async () => {
  setup({}, "");
  expect(await screen.findByText("Every journey. Every claim.")).toBeDefined();
  expect(screen.getByText("Maya Patel")).toBeDefined();
  fireEvent.click(screen.getByRole("link", { name: "CLM-1001" }));
  window.location.hash = "#CLM-1001";
  fireEvent(window, new Event("hashchange"));
  expect(await screen.findByText("My flight was canceled.")).toBeDefined();
  expect(screen.getByText("Total $420")).toBeDefined();
  expect(screen.getByText("Prior claim")).toBeDefined();
});

it("starts work and shows progress and decision", async () => {
  const fetcher = setup();
  fireEvent.click(await screen.findByRole("button", { name: "Process claim" }));
  await waitFor(() => {
    expect(fetcher).toHaveBeenCalledWith(
      "/api/claims/CLM-1001/run",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

it("requires handler selection before sign-off", async () => {
  const fetcher = setup({
    status: "waiting_for_sign_off",
    decision: approved,
    progress: [
      {
        sequence: 1,
        thread_id: "thread-1",
        action: "decision",
        message: "Saved approval",
        time: "2026-01-01T00:00:00Z",
      },
    ],
  });
  const button = await screen.findByRole("button", {
    name: "Sign off and pay",
  });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Handler"), {
    target: { value: "HND-01" },
  });
  fireEvent.click(button);
  await waitFor(() => {
    expect(fetcher).toHaveBeenCalledWith(
      "/api/claims/CLM-1001/sign-off",
      expect.objectContaining({ body: '{"handler_id":"HND-01"}' }),
    );
  });
  expect(screen.getByText("Saved approval")).toBeDefined();
});

it("retries a saved unpaid approval", async () => {
  const fetcher = setup({ status: "decided", decision: approved });
  fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
  await waitFor(() => {
    expect(fetcher).toHaveBeenCalledWith(
      "/api/claims/CLM-1001/pay",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

it("shows paid and signed-off amounts", async () => {
  setup({
    status: "decided",
    decision: approved,
    payment: { amount: "1250.00", time: "2026-01-01" },
    sign_off: { name: "Dana", time: "2026-01-01" },
  });
  expect(await screen.findByText(/Signed off by Dana/)).toBeDefined();
  expect(screen.getAllByText("$1,250.00")).toHaveLength(2);
});

it.each(["decline", "refer"])(
  "shows %s without payment controls",
  async (outcome) => {
    setup({
      status: "decided",
      decision: { ...approved, outcome, amount: "0" },
    });
    expect(
      await screen.findByRole("heading", {
        name: outcome === "refer" ? "Refer" : "Decline",
      }),
    ).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  },
);

it("shows active activity and errors", async () => {
  setup({
    status: "in_progress",
    active: true,
    progress: [
      {
        sequence: 1,
        thread_id: "thread-1",
        action: "error",
        message: "Provider unavailable",
        time: "2026-01-01",
      },
    ],
  });
  expect(await screen.findByText("Review in progress…")).toBeDefined();
  expect(screen.getByText("Provider unavailable")).toBeDefined();
});

it("shows read-only instructions", async () => {
  setup({}, "#instructions");
  expect(
    await screen.findByText("Decide using the full policy wording."),
  ).toBeDefined();
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("handles failed loads", async () => {
  window.location.hash = "#missing";
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("{}", { status: 404 })),
  );
  render(<App />);
  expect(await screen.findByRole("alert")).toBeDefined();
});

it("handles network failures", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  render(<App />);
  expect(await screen.findByRole("alert")).toBeDefined();
});

it("renders nested records and missing values", () => {
  render(
    <Records value={{ empty: null, list: [], value: false, name: "Test" }} />,
  );
  expect(screen.getAllByText("None")).toHaveLength(2);
  expect(screen.getByText("false")).toBeDefined();
});

it("shows an empty queue", async () => {
  window.location.hash = "";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]")));
  render(<App />);
  expect(await screen.findByText("No claims in the queue.")).toBeDefined();
});

it("keeps a failed action visible", async () => {
  const fetcher = setup();
  const button = await screen.findByRole("button", { name: "Process claim" });
  fetcher.mockRejectedValueOnce(new Error("Unable to start"));
  fireEvent.click(button);
  expect(await screen.findByText("Unable to start")).toBeDefined();
});

it("ignores an old detail response after navigating to instructions", async () => {
  window.location.hash = "#CLM-1001";
  let resolveClaim: (response: Response) => void = (response) => {
    throw new Error(response.statusText);
  };
  const pending = new Promise<Response>((resolve) => {
    resolveClaim = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.endsWith("/CLM-1001")) return pending;
      if (url.endsWith("/instructions"))
        return Promise.resolve(new Response('{"text":"Current instructions"}'));
      return Promise.resolve(new Response("[]"));
    }),
  );
  render(<App />);
  fireEvent.click(screen.getByRole("link", { name: "Agent instructions" }));
  window.location.hash = "#instructions";
  fireEvent(window, new Event("hashchange"));
  expect(await screen.findByText("Current instructions")).toBeDefined();
  resolveClaim(new Response(JSON.stringify(base)));
  await waitFor(() => {
    expect(screen.queryByText("My flight was canceled.")).toBeNull();
  });
});

it("processes the queue from one button", async () => {
  const fetcher = setup({}, "");
  const button = await screen.findByRole("button", {
    name: "Process all claims",
  });
  fireEvent.click(button);
  await waitFor(() => {
    expect(fetcher).toHaveBeenCalledWith(
      "/api/claims/run",
      expect.objectContaining({ method: "POST" }),
    );
  });
  await waitFor(() => {
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

it("disables bulk processing while claims are active", async () => {
  setup({ active: true, status: "in_progress" }, "");
  const button = await screen.findByRole("button", {
    name: "Processing claims…",
  });
  expect((button as HTMLButtonElement).disabled).toBe(true);
});

it("shows a bulk start failure and allows another attempt", async () => {
  const fetcher = setup({}, "");
  const button = await screen.findByRole("button", {
    name: "Process all claims",
  });
  fetcher.mockRejectedValueOnce(new Error("Unable to start queue"));
  fireEvent.click(button);
  expect(await screen.findByText("Unable to start queue")).toBeDefined();
  expect((button as HTMLButtonElement).disabled).toBe(false);
});

it("requires confirmation before resetting claims and can cancel", async () => {
  const fetcher = setup({ status: "decided", decision: approved }, "");
  fireEvent.click(await screen.findByRole("button", { name: "Reset claims" }));
  expect(screen.getByText(/This clears decisions/)).toBeDefined();
  expect(fetcher.mock.calls.some((call) => call[0].endsWith("/reset"))).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.queryByRole("group", { name: "Reset claims confirmation" }),
  ).toBeNull();
});

it("resets after confirmation and refreshes the queue", async () => {
  const fetcher = setup({ status: "decided", decision: approved }, "");
  fireEvent.click(await screen.findByRole("button", { name: "Reset claims" }));
  fetcher.mockResolvedValueOnce(new Response('{"reset":25}'));
  fireEvent.click(screen.getByRole("button", { name: "Reset all claims" }));
  expect(
    await screen.findByText("Claims reset. All 25 claims are waiting."),
  ).toBeDefined();
  expect(fetcher).toHaveBeenCalledWith(
    "/api/claims/reset",
    expect.objectContaining({ method: "POST" }),
  );
});

it("shows reset errors and keeps the confirmation available", async () => {
  const fetcher = setup({}, "");
  fireEvent.click(await screen.findByRole("button", { name: "Reset claims" }));
  fetcher.mockRejectedValueOnce(new Error("Reset failed"));
  fireEvent.click(screen.getByRole("button", { name: "Reset all claims" }));
  expect(await screen.findByText("Reset failed")).toBeDefined();
  expect(
    screen
      .getByRole("button", {
        name: "Reset all claims",
      })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("disables reset while claims are active", async () => {
  setup({ active: true, status: "in_progress" }, "");
  const button = await screen.findByRole("button", {
    name: "Reset claims",
  });
  expect((button as HTMLButtonElement).disabled).toBe(true);
});

it("distinguishes the route from the responding model for this review", () => {
  render(
    <ClaimActivity
      claim={{
        ...base,
        progress: [
          {
            sequence: 1,
            thread_id: "old-run",
            action: "model",
            message: "provider/old",
            time: "2026-01-01",
          },
          {
            sequence: 2,
            thread_id: "thread-1",
            action: "model_requested",
            message: "openrouter/free",
            time: "2026-01-02",
          },
          {
            sequence: 3,
            thread_id: "thread-1",
            action: "model",
            message: "provider/actual:free",
            time: "2026-01-02",
          },
          {
            sequence: 4,
            thread_id: "thread-1",
            action: "model",
            message: "provider/second:free",
            time: "2026-01-02",
          },
          {
            sequence: 5,
            thread_id: "thread-1",
            action: "model_unreported",
            message: "Metadata missing",
            time: "2026-01-02",
          },
        ],
      }}
    />,
  );
  const summary = within(
    screen.getByRole("group", { name: "Model for this review" }),
  );
  expect(summary.getByText("openrouter/free")).toBeDefined();
  expect(summary.getByText("provider/actual:free")).toBeDefined();
  expect(summary.getByText("provider/second:free")).toBeDefined();
  expect(summary.queryByText("provider/old")).toBeNull();
  expect(
    summary.getByText("Some replies did not include a model name."),
  ).toBeDefined();
});

it("labels unrecorded model history and pending responses honestly", () => {
  const { rerender } = render(<ClaimActivity claim={base} />);
  expect(
    screen.getByText("The responding model was not recorded for this review."),
  ).toBeDefined();
  rerender(
    <ClaimActivity
      claim={{
        ...base,
        active: true,
        progress: [
          {
            sequence: 1,
            thread_id: "thread-1",
            action: "model_requested",
            message: "openrouter/free",
            time: "2026-01-02",
          },
        ],
      }}
    />,
  );
  expect(screen.getByText("Waiting for a model response…")).toBeDefined();
  expect(screen.getByText("Live")).toBeDefined();
});

it("identifies a scripted test model", () => {
  render(
    <ClaimActivity
      claim={{
        ...base,
        progress: [
          {
            sequence: 1,
            thread_id: "thread-1",
            action: "model",
            message: "test/scripted-claims",
            time: "2026-01-02",
          },
        ],
      }}
    />,
  );
  expect(
    screen.getByText("Scripted test model · no live AI call"),
  ).toBeDefined();
});

it("filters the queue by text and status and clears filters", async () => {
  setup({}, "");
  const search = await screen.findByLabelText("Search claims");
  fireEvent.change(search, { target: { value: "unknown person" } });
  expect(screen.getByText("No claims match your search.")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByRole("link", { name: "CLM-1001" })).toBeDefined();
  fireEvent.change(screen.getByLabelText("Queue status"), {
    target: { value: "decided" },
  });
  expect(screen.queryByRole("link", { name: "CLM-1001" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  fireEvent.change(search, { target: { value: "MAYA" } });
  expect(screen.getByRole("link", { name: "CLM-1001" })).toBeDefined();
});

it("filters from status cards, syncs the select and toggles back to all claims", async () => {
  setup({}, "");
  const decided = await screen.findByRole("button", {
    name: "Filter by Decided",
  });
  fireEvent.click(decided);
  expect(decided.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByLabelText<HTMLSelectElement>("Queue status").value).toBe(
    "decided",
  );
  expect(screen.queryByRole("link", { name: "CLM-1001" })).toBeNull();
  fireEvent.click(decided);
  expect(decided.getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("link", { name: "CLM-1001" })).toBeDefined();
});

it("skips navigation without changing the current claim route", async () => {
  setup();
  await screen.findByText("My flight was canceled.");
  fireEvent.click(screen.getByRole("link", { name: "Skip to content" }));
  expect(document.activeElement).toBe(screen.getByRole("main"));
  expect(window.location.hash).toBe("#CLM-1001");
  expect(
    screen
      .getByRole("link", { name: "Claims queue" })
      .getAttribute("aria-current"),
  ).toBe("page");
});

it.each([
  { outcome: "approve", payment: null, text: "Payment pending" },
  { outcome: "decline", payment: null, text: "No payment due" },
  {
    outcome: "approve",
    payment: { amount: "1250", time: "2026-01-01" },
    text: "Paid (simulated)",
  },
])(
  "labels payment state accurately: $text",
  async ({ outcome, payment, text }) => {
    setup(
      { status: "decided", decision: { ...approved, outcome }, payment },
      "",
    );
    expect(
      await screen.findByText(new RegExp(text.replace(/[()]/g, "\\$&"))),
    ).toBeDefined();
  },
);
