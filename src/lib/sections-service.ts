import type { PrismaClient } from "@prisma/client";

type SectionRow = {
  id: number;
  name: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export async function listSections(prisma: PrismaClient): Promise<SectionRow[]> {
  const model = (prisma as { tableSection?: unknown }).tableSection;
  if (!model) {
    return [];
  }
  const existing = await (
    model as {
      findMany: (args: { orderBy: { name: "asc" } }) => Promise<SectionRow[]>;
    }
  ).findMany({
    orderBy: { name: "asc" },
  });

  if (existing.length > 0) {
    return existing.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  await seedDefaultSections(prisma);

  return (
    await (
      model as {
        findMany: (args: { orderBy: { name: "asc" } }) => Promise<SectionRow[]>;
      }
    ).findMany({
      orderBy: { name: "asc" },
    })
  ).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function createSection(prisma: PrismaClient, input: { name: string }): Promise<SectionRow> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Section name is required");
  }
  const model = (prisma as { tableSection?: unknown }).tableSection;
  if (!model) {
    throw new Error("Section model is not available. Run prisma generate and db push.");
  }
  const existing = await (
    model as {
      findUnique: (args: { where: { name: string } }) => Promise<SectionRow | null>;
    }
  ).findUnique({ where: { name } });
  if (existing) {
    throw new Error("Section already exists");
  }
  return (model as {
    create: (args: { data: { name: string } }) => Promise<SectionRow>;
  }).create({ data: { name } });
}

async function seedDefaultSections(prisma: PrismaClient): Promise<void> {
  const model = (prisma as { tableSection?: unknown }).tableSection;
  if (!model) {
    return;
  }
  const defaults = ["Snooker", "Pool Tables", "PlayStation"];
  for (const name of defaults) {
    const exists = await (
      model as {
        findUnique: (args: { where: { name: string } }) => Promise<SectionRow | null>;
      }
    ).findUnique({ where: { name } });
    if (!exists) {
      await (
        model as {
          create: (args: { data: { name: string } }) => Promise<SectionRow>;
        }
      ).create({
        data: { name },
      });
    }
  }
}

export async function updateSection(
  prisma: PrismaClient,
  input: { id: number; name: string },
): Promise<SectionRow> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Section name is required");
  }
  const model = (prisma as { tableSection?: unknown }).tableSection;
  if (!model) {
    throw new Error("Section model is not available. Run prisma generate and db push.");
  }
  const existing = await (
    model as {
      findUnique: (args: { where: { id: number } }) => Promise<SectionRow | null>;
    }
  ).findUnique({ where: { id: input.id } });
  if (!existing) {
    throw new Error("Section not found");
  }
  const nameTaken = await (
    model as {
      findFirst: (args: { where: { name: string; id: { not: number } } }) => Promise<SectionRow | null>;
    }
  ).findFirst({
    where: { name, id: { not: input.id } },
  });
  if (nameTaken) {
    throw new Error("Section already exists");
  }
  return (model as {
    update: (args: { where: { id: number }; data: { name: string } }) => Promise<SectionRow>;
  }).update({
    where: { id: input.id },
    data: { name },
  });
}

export async function deleteSection(prisma: PrismaClient, input: { id: number }): Promise<void> {
  const model = (prisma as { tableSection?: unknown }).tableSection;
  const mapModel = (prisma as { tableSectionAssignment?: unknown }).tableSectionAssignment;
  if (!model || !mapModel) {
    throw new Error("Section model is not available. Run prisma generate and db push.");
  }
  const existing = await (
    model as {
      findUnique: (args: { where: { id: number } }) => Promise<SectionRow | null>;
    }
  ).findUnique({ where: { id: input.id } });
  if (!existing) {
    throw new Error("Section not found");
  }
  const linkedCount = await (
    mapModel as {
      count: (args: { where: { sectionId: number } }) => Promise<number>;
    }
  ).count({
    where: { sectionId: input.id },
  });
  if (linkedCount > 0) {
    throw new Error("Cannot delete section with linked tables");
  }
  await (
    model as {
      delete: (args: { where: { id: number } }) => Promise<unknown>;
    }
  ).delete({
    where: { id: input.id },
  });
}
