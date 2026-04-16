const { PrismaClient } = require("@prisma/client");
const { createHash } = require("node:crypto");

const prisma = new PrismaClient();

function hashPin(pin) {
  return createHash("sha256").update(`cuedesk-pin:${pin}`).digest("hex");
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function businessDayKey(date) {
  const d = new Date(date);
  const boundary = new Date(d);
  boundary.setHours(10, 0, 0, 0);
  if (d < boundary) {
    boundary.setDate(boundary.getDate() - 1);
  }
  const yyyy = boundary.getFullYear();
  const mm = String(boundary.getMonth() + 1).padStart(2, "0");
  const dd = String(boundary.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function computeAmount(tableName, ratePerMin, startTime, endTime) {
  const diffMs = endTime.getTime() - startTime.getTime();
  if (diffMs <= 0) {
    return 0;
  }
  if (tableName.toUpperCase().startsWith("PS")) {
    const billedHours = Math.ceil(diffMs / (60 * 60 * 1000));
    return roundMoney(billedHours * ratePerMin * 60);
  }
  const minutes = Math.floor(diffMs / 60000);
  return roundMoney(Math.max(0, minutes * ratePerMin));
}

function atLocal(baseDate, hours, minutes) {
  const d = new Date(baseDate);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function groupSizeForIndex(index, remaining) {
  const pattern = [1, 2, 1, 3, 2, 1, 2, 1];
  let size = pattern[index % pattern.length];
  if (size > remaining) {
    size = remaining;
  }
  if (remaining === 4 && size === 3) {
    return 2;
  }
  return size;
}

async function main() {
  console.log("Resetting CueDesk data for robust month-backfill demo...");

  await prisma.sessionOverrideEvent.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.session.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.dailyReport.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.table.deleteMany();

  const tablesSeed = [
    { name: "S1", ratePerMin: 6 },
    { name: "S2", ratePerMin: 6 },
    { name: "S3", ratePerMin: 8 },
    { name: "IP", ratePerMin: 4 },
    { name: "AP", ratePerMin: 5 },
    { name: "PS1", ratePerMin: 200 / 60 },
    { name: "PS2", ratePerMin: 200 / 60 },
  ];
  const tables = {};
  for (const row of tablesSeed) {
    const created = await prisma.table.create({ data: row });
    tables[created.name] = created;
  }

  await prisma.user.createMany({
    data: [
      { name: "Saif", pinHash: hashPin("9345"), role: "admin", isActive: true },
      { name: "Ravi", pinHash: hashPin("1111"), role: "operator", isActive: true },
      { name: "Anjali", pinHash: hashPin("2222"), role: "operator", isActive: true },
      { name: "Imran", pinHash: hashPin("3333"), role: "operator", isActive: true },
    ],
  });

  const names = [
    "Aarav", "Vivaan", "Aditya", "Arjun", "Kabir", "Ishaan", "Rohan", "Karthik", "Rahul",
    "Sai", "Vikram", "Yash", "Pranav", "Amaan", "Zaid", "Faizan", "Saif", "Imran", "Armaan",
    "Jatin", "Ritesh", "Manav", "Tanmay", "Harsh", "Nikhil", "Akash", "Siddharth", "Dev",
    "Aisha", "Ananya", "Diya", "Meera", "Sanya", "Priya", "Nisha", "Pooja", "Sneha", "Kavya",
    "Ritika", "Neha", "Shreya", "Nandini", "Ira", "Myra", "Khushi", "Riya", "Sakshi", "Tara",
  ];

  const customers = names.map((name, i) => ({
    name,
    phone: `98${String(50000000 + i).padStart(8, "0")}`,
    lastSeenAt: new Date(Date.now() - i * 36 * 60 * 60 * 1000),
  }));
  await prisma.customer.createMany({ data: customers });

  const phoneByName = new Map(customers.map((c) => [c.name.toLowerCase(), c.phone]));
  const tableCycle = ["S1", "S2", "S3", "IP", "AP", "PS1", "PS2"];

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 11, 0, 0, 0);
  const lastDay = Math.max(1, now.getDate() - 1);

  const normalSessionsByDay = new Map();
  let sessionCounter = 0;

  for (let day = 0; day < lastDay; day += 1) {
    const dayDate = new Date(monthStart);
    dayDate.setDate(monthStart.getDate() + day);
    const dayKey = businessDayKey(dayDate);
    const sessionsToday = 9 + (day % 4); // 9 to 12 sessions/day

    for (let i = 0; i < sessionsToday; i += 1) {
      sessionCounter += 1;
      const tableName = tableCycle[(day * 3 + i) % tableCycle.length];
      const table = tables[tableName];
      const playerName = names[(day * 5 + i * 2) % names.length];

      const startHour = 10 + (i % 10);
      const startMinute = (i * 11 + day * 7) % 60;
      const start = atLocal(dayDate, startHour, startMinute);
      const duration = 40 + ((day + i) % 8) * 15;
      const end = new Date(start.getTime() + duration * 60 * 1000);

      const marker = (day * 13 + i * 17) % 100;
      const outcome = marker < 82 ? "NORMAL" : marker < 91 ? "LTP_LOSS" : "CANCELLED";
      const amount = outcome === "NORMAL" ? computeAmount(tableName, table.ratePerMin, start, end) : 0;
      const payerMode = i % 3 === 0 ? "single" : i % 3 === 1 ? "split" : "none";
      const payerData = payerMode === "single"
        ? { name: playerName }
        : payerMode === "split"
          ? [
            { name: playerName, percentage: 60 },
            { name: names[(day + i + 7) % names.length], percentage: 40 },
          ]
          : null;

      const session = await prisma.session.create({
        data: {
          tableId: table.id,
          businessDayKey: dayKey,
          playerName,
          payerMode,
          payerData,
          startTime: start,
          endTime: end,
          status: "completed",
          outcome,
          amount,
          cancellationReason: outcome === "CANCELLED" ? "Operator cancelled demo session" : null,
          canceledAt: outcome === "CANCELLED" ? new Date(start.getTime() + 10 * 60000) : null,
        },
      });

      const hasOverride = (sessionCounter % 4 === 0);
      if (hasOverride) {
        await prisma.sessionOverrideEvent.create({
          data: {
            sessionId: session.id,
            action: "override_update",
            changedFields: [{ field: "playerName", before: playerName, after: `${playerName} Kumar` }],
            beforeData: { playerName, amount },
            afterData: { playerName: `${playerName} Kumar`, amount },
            createdAt: new Date(start.getTime() + 35 * 60000),
          },
        });
      }

      if (outcome !== "NORMAL") {
        continue;
      }

      const list = normalSessionsByDay.get(dayKey) ?? [];
      list.push({
        id: session.id,
        dayKey,
        playerName,
        start,
        end,
        amount,
      });
      normalSessionsByDay.set(dayKey, list);
    }
  }

  let billCounter = 0;
  const dayKeys = Array.from(normalSessionsByDay.keys()).sort();
  for (let dayIndex = 0; dayIndex < dayKeys.length; dayIndex += 1) {
    const dayKey = dayKeys[dayIndex];
    const sessions = [...(normalSessionsByDay.get(dayKey) ?? [])]
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    let idx = 0;
    while (idx < sessions.length) {
      const remaining = sessions.length - idx;
      const groupSize = groupSizeForIndex(billCounter + dayIndex, remaining);
      const chunk = sessions.slice(idx, idx + groupSize);
      idx += groupSize;

      const subtotal = roundMoney(chunk.reduce((sum, s) => sum + s.amount, 0));
      const discountType = billCounter % 5 === 0 ? "percent" : billCounter % 5 === 1 ? "fixed" : null;
      const discountValue = discountType === "percent" ? 10 : discountType === "fixed" ? 40 : null;
      const discountedAmount = discountType === "percent"
        ? roundMoney(subtotal * 0.9)
        : discountType === "fixed"
          ? roundMoney(Math.max(subtotal - 40, 0))
          : subtotal;

      const maxEnd = chunk.reduce((latest, s) =>
        (s.end.getTime() > latest.getTime() ? s.end : latest), chunk[0].end);
      const billCreatedAt = new Date(maxEnd.getTime() + 20 * 60000);
      const bill = await prisma.bill.create({
        data: {
          totalAmount: subtotal,
          discountType,
          discountValue,
          discountedAmount,
          createdAt: billCreatedAt,
        },
      });

      await prisma.session.updateMany({
        where: { id: { in: chunk.map((s) => s.id) } },
        data: { billId: bill.id, status: "completed" },
      });

      const paymentAt = new Date(billCreatedAt.getTime() + 5 * 60000);
      const leadName = chunk[0].playerName;
      const customerPhone = phoneByName.get(leadName.toLowerCase()) ?? `98${String(80000000 + billCounter).padStart(8, "0")}`;
      const pattern = billCounter % 6;

      if (pattern === 0) {
        await prisma.payment.create({
          data: { billId: bill.id, mode: "cash", amount: discountedAmount, createdAt: paymentAt },
        });
      } else if (pattern === 1) {
        await prisma.payment.create({
          data: { billId: bill.id, mode: "upi", amount: discountedAmount, createdAt: paymentAt },
        });
      } else if (pattern === 2) {
        await prisma.payment.create({
          data: { billId: bill.id, mode: "card", amount: discountedAmount, createdAt: paymentAt },
        });
      } else if (pattern === 3) {
        const cashPart = roundMoney(discountedAmount * 0.5);
        const duePart = roundMoney(discountedAmount - cashPart);
        await prisma.payment.createMany({
          data: [
            { billId: bill.id, mode: "cash", amount: cashPart, createdAt: paymentAt },
            {
              billId: bill.id,
              mode: "due",
              amount: duePart,
              dueCustomerName: leadName,
              dueCustomerPhone: customerPhone,
              createdAt: paymentAt,
            },
          ],
        });
      } else if (pattern === 4) {
        await prisma.payment.create({
          data: {
            billId: bill.id,
            mode: "due",
            amount: discountedAmount,
            dueCustomerName: leadName,
            dueCustomerPhone: customerPhone,
            createdAt: paymentAt,
          },
        });
      } else {
        const upiPart = roundMoney(discountedAmount * 0.6);
        const duePart = roundMoney(discountedAmount - upiPart);
        await prisma.payment.createMany({
          data: [
            { billId: bill.id, mode: "upi", amount: upiPart, createdAt: paymentAt },
            {
              billId: bill.id,
              mode: "due",
              amount: duePart,
              dueCustomerName: leadName,
              dueCustomerPhone: customerPhone,
              createdAt: paymentAt,
            },
          ],
        });
      }

      billCounter += 1;
    }
  }

  // Due receive events can happen later, outside source business day.
  const activeDueRows = await prisma.payment.findMany({
    where: { mode: "due", dueSettledAt: null, amount: { gt: 0 } },
    orderBy: { id: "asc" },
    select: { id: true, billId: true, amount: true, createdAt: true },
  });

  for (let i = 0; i < activeDueRows.length; i += 1) {
    const row = activeDueRows[i];
    if (i % 10 >= 7) {
      continue;
    }
    const settleAt = new Date(row.createdAt);
    settleAt.setDate(settleAt.getDate() + 2 + (i % 6));
    settleAt.setHours(14 + (i % 4), (i * 7) % 60, 0, 0);
    if (settleAt > now) {
      continue;
    }
    const receiveMode = i % 2 === 0 ? "cash" : "upi";

    await prisma.payment.update({
      where: { id: row.id },
      data: {
        amount: 0,
        dueSettledAt: settleAt,
        dueReceivedMode: receiveMode,
      },
    });

    await prisma.payment.create({
      data: {
        billId: row.billId,
        mode: receiveMode,
        amount: row.amount,
        dueSettledAt: settleAt,
        dueReceivedMode: receiveMode,
        createdAt: settleAt,
      },
    });
  }

  const counts = await Promise.all([
    prisma.table.count(),
    prisma.session.count(),
    prisma.bill.count(),
    prisma.payment.count(),
    prisma.customer.count(),
    prisma.user.count(),
    prisma.sessionOverrideEvent.count(),
  ]);

  const range = await prisma.session.aggregate({
    _min: { businessDayKey: true },
    _max: { businessDayKey: true },
  });

  const multiBillCount = await prisma.session.groupBy({
    by: ["billId"],
    _count: { billId: true },
    where: { billId: { not: null } },
  });
  const withMultipleSessions = multiBillCount.filter((row) => row.billId && row._count.billId > 1).length;

  console.log("Seed complete:");
  console.log(`- Tables: ${counts[0]}`);
  console.log(`- Sessions: ${counts[1]}`);
  console.log(`- Bills: ${counts[2]}`);
  console.log(`- Payments: ${counts[3]}`);
  console.log(`- Customers: ${counts[4]}`);
  console.log(`- Users: ${counts[5]}`);
  console.log(`- History events: ${counts[6]}`);
  console.log(`- Business-day range: ${range._min.businessDayKey} to ${range._max.businessDayKey}`);
  console.log(`- Bills with multiple sessions: ${withMultipleSessions}`);
  console.log("Login: Saif / 9345");
}

main()
  .catch((error) => {
    console.error("Reset/seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
