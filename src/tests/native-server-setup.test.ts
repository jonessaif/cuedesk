import { describe, expect, it } from "vitest";

import {
  isNativeServerSetupAvailable,
  openNativeServerSetup,
} from "@/lib/native-server-setup";

describe("native-server-setup", () => {
  it("returns false when native bridge is unavailable", () => {
    const previousWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {} as unknown;
    expect(isNativeServerSetupAvailable()).toBe(false);
    expect(openNativeServerSetup()).toBe(false);
    (globalThis as { window?: unknown }).window = previousWindow;
  });

  it("opens deep link when native bridge is available", () => {
    const previousWindow = (globalThis as { window?: unknown }).window;
    const windowMock = {
      location: { href: "http://localhost" },
      Capacitor: { isNativePlatform: () => true },
    };
    (globalThis as { window?: unknown }).window = windowMock as unknown;
    expect(isNativeServerSetupAvailable()).toBe(true);
    expect(openNativeServerSetup()).toBe(true);
    expect(windowMock.location.href).toBe("cuedesk://server-config");
    (globalThis as { window?: unknown }).window = previousWindow;
  });
});
