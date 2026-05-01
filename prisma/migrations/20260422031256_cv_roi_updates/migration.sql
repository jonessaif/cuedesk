/*
  Warnings:

  - You are about to alter the column `roiQuadrilateral` on the `camera_table_mappings` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_camera_table_mappings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cameraId" INTEGER NOT NULL,
    "tableId" INTEGER NOT NULL,
    "detectionType" TEXT NOT NULL,
    "roiX" REAL NOT NULL,
    "roiY" REAL NOT NULL,
    "roiWidth" REAL NOT NULL,
    "roiHeight" REAL NOT NULL,
    "roiAngle" REAL NOT NULL DEFAULT 0,
    "roiTiltX" REAL NOT NULL DEFAULT 0,
    "roiTiltY" REAL NOT NULL DEFAULT 0,
    "roiKind" TEXT NOT NULL DEFAULT 'rectangle',
    "roiQuadrilateral" JSONB,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "camera_table_mappings_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "cameras" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "camera_table_mappings_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_camera_table_mappings" ("cameraId", "createdAt", "detectionType", "id", "isEnabled", "roiAngle", "roiHeight", "roiKind", "roiQuadrilateral", "roiTiltX", "roiTiltY", "roiWidth", "roiX", "roiY", "tableId", "updatedAt") SELECT "cameraId", "createdAt", "detectionType", "id", "isEnabled", "roiAngle", "roiHeight", "roiKind", "roiQuadrilateral", "roiTiltX", "roiTiltY", "roiWidth", "roiX", "roiY", "tableId", "updatedAt" FROM "camera_table_mappings";
DROP TABLE "camera_table_mappings";
ALTER TABLE "new_camera_table_mappings" RENAME TO "camera_table_mappings";
CREATE INDEX "camera_table_mappings_tableId_detectionType_idx" ON "camera_table_mappings"("tableId", "detectionType");
CREATE UNIQUE INDEX "camera_table_mappings_cameraId_tableId_key" ON "camera_table_mappings"("cameraId", "tableId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
