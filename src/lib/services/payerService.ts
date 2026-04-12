export const payerService = {
  async assignPayer(
    prisma: unknown,
    input: {
      sessionId: number;
      payerMode: string;
      payerData: unknown;
    },
  ) {
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;

    const session = (await (
      sessionModel as {
        findUnique: (args: { where: { id: number } }) => Promise<unknown>;
      }
    ).findUnique({
      where: { id: input.sessionId },
    })) as { status: string } | null;

    if (!session) {
      throw new Error("Session not found");
    }

    if (session.status !== "running") {
      throw new Error("Session not running");
    }

    if (input.payerMode === "split") {
      if (!Array.isArray(input.payerData)) {
        throw new Error("Invalid split percentage");
      }

      const total = input.payerData.reduce((sum, row) => {
        const p = (row as { percentage?: unknown })?.percentage;
        if (typeof p !== "number") {
          throw new Error("Invalid split percentage");
        }
        return sum + p;
      }, 0);

      if (Math.round(total) !== 100) {
        throw new Error("Invalid split percentage");
      }
    }

    return (
      sessionModel as {
        update: (args: {
          where: { id: number };
          data: { payerMode: string; payerData: unknown };
        }) => Promise<unknown>;
      }
    ).update({
      where: { id: input.sessionId },
      data: {
        payerMode: input.payerMode,
        payerData: input.payerData,
      },
    });
  },
};
