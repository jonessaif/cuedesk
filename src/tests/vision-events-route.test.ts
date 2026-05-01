import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
  prisma: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/services/vision-event-service", () => ({
  visionEventService: {
    ingest: mocks.ingest,
  },
}));

import { POST as visionEventsPost } from "@/app/api/vision/events/route";

function jsonRequest(url: string, body: unknown, headers?: HeadersInit) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
}

describe("vision events route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ingest.mockResolvedValue({ id: 1, tableId: 2, event: "start" });
    delete process.env.CV_WORKER_TOKEN;
  });

  it("accepts event payload and returns 201", async () => {
    const res = await visionEventsPost(jsonRequest("http://localhost/api/vision/events", {
      tableId: 2,
      cameraId: 3,
      detectionType: "snooker",
      event: "start",
      confidence: 0.85,
      sectionName: "Snooker Zone",
    }));
    expect(res.status).toBe(201);
    expect(mocks.ingest).toHaveBeenCalledTimes(1);
    expect(mocks.ingest).toHaveBeenCalledWith(
      mocks.prisma,
      {
        tableId: 2,
        cameraId: 3,
        detectionType: "snooker",
        event: "start",
        confidence: 0.85,
        eventAt: undefined,
        source: undefined,
        payload: undefined,
      },
    );
  });

  it("returns 401 for invalid worker token when enabled", async () => {
    process.env.CV_WORKER_TOKEN = "secret-token";
    const res = await visionEventsPost(jsonRequest("http://localhost/api/vision/events", {
      tableId: 2,
      event: "start",
    }, { "x-cv-token": "wrong-token" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when ingest throws validation error", async () => {
    mocks.ingest.mockRejectedValueOnce(new Error("Invalid tableId"));
    const res = await visionEventsPost(jsonRequest("http://localhost/api/vision/events", {
      tableId: -1,
      event: "start",
    }));
    expect(res.status).toBe(400);
  });
});
