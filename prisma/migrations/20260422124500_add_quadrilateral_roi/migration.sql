ALTER TABLE "camera_table_mappings"
ADD COLUMN "roiKind" TEXT NOT NULL DEFAULT 'rectangle';

ALTER TABLE "camera_table_mappings"
ADD COLUMN "roiQuadrilateral" TEXT;
