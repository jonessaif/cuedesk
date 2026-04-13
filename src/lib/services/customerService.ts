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
    input: { query: string; limit?: number },
  ) {
    const customerModel = (prisma as { customer?: unknown; customers?: unknown }).customer ??
      (prisma as { customer?: unknown; customers?: unknown }).customers;
    const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
      (prisma as { payment?: unknown; payments?: unknown }).payments;
    if (!customerModel) {
      if (!paymentModel) {
        return [];
      }
    }

    const query = input.query.trim();
    if (!query) {
      return [];
    }

    const limit = input.limit ?? 8;
    const rows = customerModel
      ? await (
        customerModel as {
          findMany: (args: {
            where: {
              OR: Array<{ name: { contains: string } } | { phone: { contains: string } }>;
            };
            orderBy: { lastSeenAt: "desc" };
            take: number;
            select: { id: true; name: true; phone: true; lastSeenAt: true };
          }) => Promise<Array<{ id: number; name: string; phone: string; lastSeenAt: Date }>>;
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

    if (rows.length >= limit || !paymentModel) {
      return rows;
    }

    const dueRows = await (
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
    });

    const existingPhones = new Set(rows.map((row) => row.phone));
    const fallback = dueRows
      .map((row) => ({
        id: row.id,
        name: row.dueCustomerName ?? "",
        phone: row.dueCustomerPhone ?? "",
        lastSeenAt: new Date(),
      }))
      .filter((row) => row.name && row.phone && !existingPhones.has(row.phone));

    return [...rows, ...fallback].slice(0, limit);
  },
};
