"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
