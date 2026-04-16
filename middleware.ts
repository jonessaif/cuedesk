import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isValidUserHeader(raw: string | null): boolean {
  if (!raw) {
    return false;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0;
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // Allow login endpoint without prior auth header.
  if (pathname === "/api/auth/login") {
    return NextResponse.next();
  }

  const userHeader = request.headers.get("x-user-id");
  if (!isValidUserHeader(userHeader)) {
    return NextResponse.json({ error: "Unauthorized: login required" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
