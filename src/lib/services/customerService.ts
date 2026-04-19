export const customerService = {
  async upsertCustomer(
    prisma: unknown,
    input: {
      name: string;
      phone: string;
    },
  ) {
    const customerModel = (prisma as { customer?: unknown; customers?: unknown }).customer ??
      (prisma as { customer?: unknown; customers?: unknown }).customers;
    if (!customerModel) {
      return null;
    }

    const name = input.name.trim();
    const phone = input.phone.trim();
    if (!name || !phone) {
      return null;
    }

    return (
      customerModel as {
        upsert: (args: {
          where: { phone: string };
          create: { name: string; phone: string; lastSeenAt: Date };
          update: { name: string; lastSeenAt: Date };
        }) => Promise<unknown>;
      }
    ).upsert({
      where: { phone },
      create: { name, phone, lastSeenAt: new Date() },
      update: { name, lastSeenAt: new Date() },
    });
  },

  async searchCustomers(
    prisma: unknown,
    input: { query: string; limit?: number; includeSessionNames?: boolean },
  ) {
    const customerModel = (prisma as { customer?: unknown; customers?: unknown }).customer ??
      (prisma as { customer?: unknown; customers?: unknown }).customers;
    const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
      (prisma as { payment?: unknown; payments?: unknown }).payments;
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;
    if (!customerModel) {
      if (!paymentModel) {
        return [];
      }
    }

    const query = input.query.trim();
    if (!query) {
      return [];
    }
    const normalizedQuery = query.toLowerCase();

    const limit = input.limit ?? 8;
    const toSafeDate = (value: unknown): Date => {
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
      }
      if (typeof value === "number" || typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
      return new Date(0);
    };
    const customerRows = customerModel
      ? await (
        customerModel as {
          findMany: (args: {
            where: {
              OR: Array<{ name: { contains: string } } | { phone: { contains: string } }>;
            };
            orderBy: { lastSeenAt: "desc" };
            take: number;
            select: { id: true; name: true; phone: true; lastSeenAt: true };
        }) => Promise<Array<{ id: number; name: string; phone: string | null; lastSeenAt: Date }>>;
        }
      ).findMany({
        where: {
          OR: [
            { name: { contains: query } },
            { phone: { contains: query } },
          ],
        },
        orderBy: { lastSeenAt: "desc" },
        take: limit,
        select: { id: true, name: true, phone: true, lastSeenAt: true },
      })
      : [];

    if (customerRows.length >= limit || !paymentModel) {
      if (!input.includeSessionNames) {
        return customerRows;
      }
    }

    const shouldIncludeDueFallback = !input.includeSessionNames;
    const dueRows = shouldIncludeDueFallback && paymentModel
      ? await (
        paymentModel as {
          findMany: (args: {
            where: {
              mode: "due";
              OR: Array<{ dueCustomerName: { contains: string } } | { dueCustomerPhone: { contains: string } }>;
            };
            orderBy: { id: "desc" };
            take: number;
            select: {
              id: true;
              dueCustomerName: true;
              dueCustomerPhone: true;
            };
          }) => Promise<Array<{
            id: number;
            dueCustomerName: string | null;
            dueCustomerPhone: string | null;
          }>>;
        }
      ).findMany({
        where: {
          mode: "due",
          OR: [
            { dueCustomerName: { contains: query } },
            { dueCustomerPhone: { contains: query } },
          ],
        },
        orderBy: { id: "desc" },
        take: limit,
        select: {
          id: true,
          dueCustomerName: true,
          dueCustomerPhone: true,
        },
      })
      : [];

    const existingPhones = new Set(
      customerRows
        .map((row) => row.phone?.trim() ?? "")
        .filter((phone) => phone.length > 0),
    );
    const dueFallback = dueRows
      .map((row) => ({
        id: row.id,
        name: row.dueCustomerName ?? "",
        phone: row.dueCustomerPhone ?? "",
        lastSeenAt: toSafeDate(Date.now()),
      }))
      .filter((row) => row.name && row.phone && !existingPhones.has(row.phone));

    if (!input.includeSessionNames || !sessionModel) {
      return [...customerRows, ...dueFallback].slice(0, limit);
    }

    let recentSessionRows: Array<{ playerName: string; startTime: Date }> = [];
    try {
      recentSessionRows = await (
        sessionModel as {
          findMany: (args: {
            orderBy: { startTime: "desc" };
            take: number;
            select: { playerName: true; startTime: true };
          }) => Promise<Array<{ playerName: string; startTime: Date }>>;
        }
      ).findMany({
        orderBy: { startTime: "desc" },
        take: Math.max(limit * 300, 5000),
        select: { playerName: true, startTime: true },
      });
    } catch {
      recentSessionRows = [];
    }
    const sessionRows = recentSessionRows.filter((row) =>
      row.playerName.trim().toLowerCase().includes(normalizedQuery)
    );

    const stats = new Map<string, {
      key: string;
      name: string;
      phone: string;
      lastSeenAt: Date;
      frequency: number;
      sourceRank: number;
      customerId?: number;
    }>();

    for (const row of customerRows) {
      const key = row.name.trim().toLowerCase();
      if (!key) {
        continue;
      }
      const existing = stats.get(key);
      if (!existing) {
        stats.set(key, {
          key,
          name: row.name.trim(),
          phone: row.phone?.trim() ?? "",
          lastSeenAt: toSafeDate(row.lastSeenAt),
          frequency: 1,
          sourceRank: 0,
          customerId: row.id,
        });
        continue;
      }
      existing.frequency += 1;
      if (toSafeDate(row.lastSeenAt).getTime() > existing.lastSeenAt.getTime()) {
        existing.lastSeenAt = toSafeDate(row.lastSeenAt);
      }
      if (!existing.phone && row.phone?.trim()) {
        existing.phone = row.phone.trim();
      }
      if (typeof existing.customerId !== "number") {
        existing.customerId = row.id;
      }
    }

    for (const row of dueFallback) {
      const key = row.name.trim().toLowerCase();
      if (!key) {
        continue;
      }
      const existing = stats.get(key);
      if (!existing) {
        stats.set(key, {
          key,
          name: row.name.trim(),
          phone: row.phone.trim(),
          lastSeenAt: row.lastSeenAt,
          frequency: 1,
          sourceRank: 1,
        });
        continue;
      }
      existing.frequency += 1;
      if (row.lastSeenAt.getTime() > existing.lastSeenAt.getTime()) {
        existing.lastSeenAt = row.lastSeenAt;
      }
      if (!existing.phone && row.phone.trim()) {
        existing.phone = row.phone.trim();
      }
    }

    for (const row of sessionRows) {
      const name = row.playerName.trim();
      if (!name) {
        continue;
      }
      const sessionStart = toSafeDate(row.startTime);
      const key = name.toLowerCase();
      const existing = stats.get(key);
      if (!existing) {
        stats.set(key, {
          key,
          name,
          phone: "",
          lastSeenAt: sessionStart,
          frequency: 1,
          sourceRank: 2,
        });
        continue;
      }
      existing.frequency += 1;
      if (sessionStart.getTime() > existing.lastSeenAt.getTime()) {
        existing.lastSeenAt = sessionStart;
        existing.name = name;
      }
    }

    const ranked = Array.from(stats.values())
      .sort((a, b) => {
        if (b.frequency !== a.frequency) {
          return b.frequency - a.frequency;
        }
        const recencyDiff = b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
        if (recencyDiff !== 0) {
          return recencyDiff;
        }
        if (a.sourceRank !== b.sourceRank) {
          return a.sourceRank - b.sourceRank;
        }
        return a.name.localeCompare(b.name);
      })
      .map((entry, index) => ({
        id: entry.customerId ?? -(index + 1),
        name: entry.name,
        phone: entry.phone,
        lastSeenAt: entry.lastSeenAt,
        isSessionOnly: !entry.phone && typeof entry.customerId !== "number",
      }));
    const top = ranked.slice(0, limit);
    const sessionOnly = ranked.filter((entry) => entry.isSessionOnly);
    const minimumSessionOnly = Math.min(2, sessionOnly.length);
    const hasSessionOnlyInTop = top.filter((entry) => entry.isSessionOnly).length;
    if (minimumSessionOnly > 0 && hasSessionOnlyInTop < minimumSessionOnly) {
      const nonSessionTop = top.filter((entry) => !entry.isSessionOnly);
      const guaranteedSessionOnly = sessionOnly.slice(0, minimumSessionOnly);
      const fillCount = Math.max(limit - guaranteedSessionOnly.length, 0);
      const mixed = [...guaranteedSessionOnly, ...nonSessionTop.slice(0, fillCount)];
      return mixed
        .slice(0, limit)
        .map(({ isSessionOnly: _isSessionOnly, ...entry }) => entry);
    }

    return top.map(({ isSessionOnly: _isSessionOnly, ...entry }) => entry);
  },

  async resolveCustomerByPayerName(
    prisma: unknown,
    input: { payerName: string },
  ) {
    const customerModel = (prisma as { customer?: unknown; customers?: unknown }).customer ??
      (prisma as { customer?: unknown; customers?: unknown }).customers;
    if (!customerModel) {
      return null;
    }

    const payerName = input.payerName.trim();
    if (!payerName) {
      return null;
    }

    const existing = await (
      customerModel as {
        findMany: (args: {
          where: { name: { equals: string } };
          orderBy: Array<{ lastSeenAt: "desc" } | { id: "asc" }>;
          take: number;
          select: { id: true; name: true; phone: true };
        }) => Promise<Array<{ id: number; name: string; phone: string | null }>>;
      }
    ).findMany({
      where: { name: { equals: payerName } },
      orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
      take: 1,
      select: { id: true, name: true, phone: true },
    });

    if (existing.length > 0) {
      const row = existing[0];
      await (
        customerModel as {
          update: (args: {
            where: { id: number };
            data: { name: string; lastSeenAt: Date };
          }) => Promise<unknown>;
        }
      ).update({
        where: { id: row.id },
        data: {
          name: payerName,
          lastSeenAt: new Date(),
        },
      });
      return { id: row.id, name: payerName, phone: row.phone };
    }

    const created = await (
      customerModel as {
        create: (args: {
          data: { name: string; phone: string | null; lastSeenAt: Date };
          select: { id: true; name: true; phone: true };
        }) => Promise<{ id: number; name: string; phone: string | null }>;
      }
    ).create({
      data: {
        name: payerName,
        phone: null,
        lastSeenAt: new Date(),
      },
      select: { id: true, name: true, phone: true },
    });

    return created;
  },
};
