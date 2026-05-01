import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOperatorOrAdmin: vi.fn(),
  overrideSession: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
}));

vi.mock("@/lib/services/sessionService", () => ({
  sessionService: {
    overrideSession: mocks.overrideSession,
  },
}));

import { POST as overrideRoute } from "@/app/api/session/override/route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/session/override", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("session/override route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 1, role: "operator" });
    mocks.overrideSession.mockResolvedValue({ id: 1, overrideStatus: "completed" });
  });

  it("validates override fields thoroughly", async () => {
    const cases: Array<{ body: unknown; error: string }> = [
      { body: { sessionId: 1, overrideStartTime: 123 }, error: "Invalid overrideStartTime" },
      { body: { sessionId: 1, overrideEndTime: 123 }, error: "Invalid overrideEndTime" },
      { body: { sessionId: 1, overrideRatePerMin: 0 }, error: "Invalid overrideRatePerMin" },
      { body: { sessionId: 1, overridePlayerName: "" }, error: "Invalid overridePlayerName" },
      { body: { sessionId: 1, overridePayerMode: "abc" }, error: "Invalid overridePayerMode" },
      { body: { sessionId: 1, overrideStatus: "abc" }, error: "Invalid overrideStatus" },
      { body: { sessionId: 1, overrideOutcome: "abc" }, error: "Invalid overrideOutcome" },
      { body: { sessionId: 1, overridePaymentModes: "cash" }, error: "Invalid overridePaymentModes" },
      { body: { sessionId: 1, overridePaymentModes: ["bitcoin"] }, error: "Invalid overridePaymentModes" },
      { body: { sessionId: 1, overridePayerMode: "single", overridePayerData: {} }, error: "Invalid single payer data" },
      { body: { sessionId: 1, overridePayerMode: "split", overridePayerData: {} }, error: "Invalid split payer data" },
      {
        body: { sessionId: 1, overridePayerMode: "split", overridePayerData: [{ name: "A", percentage: 60 }] },
        error: "Invalid split percentage",
      },
      {
        body: {
          sessionId: 1,
          overrideStartTime: "2026-04-20T11:00:00.000Z",
          overrideEndTime: "2026-04-20T10:00:00.000Z",
        },
        error: "Invalid override range",
      },
    ];

    for (const c of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await overrideRoute(req(c.body));
      // eslint-disable-next-line no-await-in-loop
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toContain(c.error);
    }
  });

  it("accepts valid payload including deduped payment modes and null payment modes", async () => {
    let res = await overrideRoute(req({
      sessionId: 1,
      overrideStatus: "completed",
      overridePaymentModes: ["cash", "cash", "upi"],
    }));
    expect(res.status).toBe(200);
    expect(mocks.overrideSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      overridePaymentModes: ["cash", "upi"],
    }));

    res = await overrideRoute(req({
      sessionId: 1,
      overrideStatus: "completed",
      overridePaymentModes: null,
    }));
    expect(res.status).toBe(200);
    expect(mocks.overrideSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      overridePaymentModes: null,
    }));
  });
});
