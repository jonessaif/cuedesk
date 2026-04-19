import { GET as getSessionsAll } from "@/app/api/sessions/all/route";

function parseDateKey(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function todayDateKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const scopeRaw = incoming.searchParams.get("scope");
  const scope = scopeRaw === "current" || scopeRaw === "range" || scopeRaw === "day" ? scopeRaw : "day";
  const date = parseDateKey(incoming.searchParams.get("date")) ?? todayDateKey();
  const startDate = parseDateKey(incoming.searchParams.get("startDate"));
  const endDate = parseDateKey(incoming.searchParams.get("endDate"));
  const target = new URL(request.url);
  target.pathname = "/api/sessions/all";
  target.search = "";
  if (scope === "range" && startDate && endDate && startDate <= endDate) {
    target.searchParams.set("scope", "range");
    target.searchParams.set("startDate", startDate);
    target.searchParams.set("endDate", endDate);
  } else if (scope === "current") {
    target.searchParams.set("scope", "current");
  } else {
    target.searchParams.set("scope", "day");
    target.searchParams.set("date", date);
  }
  return getSessionsAll(new Request(target.toString(), request));
}
