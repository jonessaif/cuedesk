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
  const date = parseDateKey(incoming.searchParams.get("date")) ?? todayDateKey();
  const target = new URL(request.url);
  target.pathname = "/api/sessions/all";
  target.search = "";
  target.searchParams.set("scope", "day");
  target.searchParams.set("date", date);
  return getSessionsAll(new Request(target.toString(), request));
}
