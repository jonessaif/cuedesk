-- CreateTable
CREATE TABLE "tables" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "ratePerMin" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "cameras" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "snapshotUrl" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "lastCheckedAt" DATETIME,
    "lastOnlineAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "camera_table_mappings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cameraId" INTEGER NOT NULL,
    "tableId" INTEGER NOT NULL,
    "detectionType" TEXT NOT NULL,
    "roiX" REAL NOT NULL,
    "roiY" REAL NOT NULL,
    "roiWidth" REAL NOT NULL,
    "roiHeight" REAL NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "camera_table_mappings_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "cameras" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "camera_table_mappings_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "vision_events_raw" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tableId" INTEGER NOT NULL,
    "cameraId" INTEGER,
    "detectionType" TEXT,
    "event" TEXT NOT NULL,
    "confidence" REAL,
    "eventAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'cv-worker',
    "payload" JSONB,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vision_events_raw_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "vision_events_raw_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "cameras" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "table_sections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "table_section_assignments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tableId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "table_section_assignments_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "table_section_assignments_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "table_sections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tableId" INTEGER NOT NULL,
    "businessDayKey" TEXT,
    "playerName" TEXT NOT NULL,
    "payerMode" TEXT NOT NULL DEFAULT 'none',
    "payerData" JSONB,
    "overridePayerMode" TEXT,
    "overridePayerData" JSONB,
    "overrideStatus" TEXT,
    "overridePaymentModes" JSONB,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME,
    "overrideStartTime" DATETIME,
    "overrideEndTime" DATETIME,
    "overrideRatePerMin" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'running',
    "outcome" TEXT NOT NULL DEFAULT 'NORMAL',
    "amount" REAL,
    "cancellationReason" TEXT,
    "canceledAt" DATETIME,
    "billId" INTEGER,
    CONSTRAINT "sessions_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "sessions_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "session_override_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'override_update',
    "changedFields" JSONB,
    "beforeData" JSONB,
    "afterData" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_override_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bills" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER,
    "totalAmount" REAL NOT NULL,
    "discountType" TEXT,
    "discountValue" REAL,
    "discountedAmount" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bills_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "billId" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueCustomerName" TEXT,
    "dueCustomerPhone" TEXT,
    "dueSettledAt" DATETIME,
    "dueReceivedMode" TEXT,
    CONSTRAINT "payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "businessDayKey" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "subtotal" REAL NOT NULL,
    "discount" REAL NOT NULL,
    "net" REAL NOT NULL,
    "cash" REAL NOT NULL,
    "upi" REAL NOT NULL,
    "card" REAL NOT NULL,
    "paid" REAL NOT NULL,
    "unpaid" REAL NOT NULL,
    "isBalanced" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "daily_closing" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "openingCash" REAL NOT NULL,
    "openingBank" REAL NOT NULL,
    "salesCash" REAL NOT NULL,
    "salesBank" REAL NOT NULL,
    "foodSalesCash" REAL NOT NULL DEFAULT 0,
    "foodSalesBank" REAL NOT NULL DEFAULT 0,
    "foodSalesDue" REAL NOT NULL DEFAULT 0,
    "foodDueReceivedCash" REAL NOT NULL DEFAULT 0,
    "foodDueReceivedBank" REAL NOT NULL DEFAULT 0,
    "accessoriesSalesCash" REAL NOT NULL DEFAULT 0,
    "accessoriesSalesBank" REAL NOT NULL DEFAULT 0,
    "accessoriesSalesDue" REAL NOT NULL DEFAULT 0,
    "dueReceivedCash" REAL NOT NULL,
    "dueReceivedBank" REAL NOT NULL,
    "expenseCash" REAL NOT NULL DEFAULT 0,
    "expenseBank" REAL NOT NULL DEFAULT 0,
    "newDueTotal" REAL NOT NULL DEFAULT 0,
    "closingCash" REAL NOT NULL,
    "closingBank" REAL NOT NULL,
    "actualCash" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "expense_entries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "item" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "mode" TEXT NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "expense_entries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "expense_entries_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "customers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'operator',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "app_config" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ledgerResetMinutes" INTEGER NOT NULL DEFAULT 600,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "report_chart_configs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "targetKey" TEXT NOT NULL,
    "tableId" INTEGER,
    "chartMode" TEXT NOT NULL DEFAULT 'auto',
    "mergeBucketsJson" JSONB,
    "includeClosed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "report_chart_configs_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "tables_name_key" ON "tables"("name");

-- CreateIndex
CREATE UNIQUE INDEX "cameras_url_key" ON "cameras"("url");

-- CreateIndex
CREATE INDEX "cameras_status_isEnabled_idx" ON "cameras"("status", "isEnabled");

-- CreateIndex
CREATE INDEX "camera_table_mappings_tableId_detectionType_idx" ON "camera_table_mappings"("tableId", "detectionType");

-- CreateIndex
CREATE UNIQUE INDEX "camera_table_mappings_cameraId_tableId_key" ON "camera_table_mappings"("cameraId", "tableId");

-- CreateIndex
CREATE INDEX "vision_events_raw_tableId_eventAt_idx" ON "vision_events_raw"("tableId", "eventAt");

-- CreateIndex
CREATE INDEX "vision_events_raw_cameraId_eventAt_idx" ON "vision_events_raw"("cameraId", "eventAt");

-- CreateIndex
CREATE UNIQUE INDEX "table_sections_name_key" ON "table_sections"("name");

-- CreateIndex
CREATE UNIQUE INDEX "table_section_assignments_tableId_key" ON "table_section_assignments"("tableId");

-- CreateIndex
CREATE INDEX "table_section_assignments_sectionId_idx" ON "table_section_assignments"("sectionId");

-- CreateIndex
CREATE INDEX "sessions_tableId_status_idx" ON "sessions"("tableId", "status");

-- CreateIndex
CREATE INDEX "sessions_businessDayKey_idx" ON "sessions"("businessDayKey");

-- CreateIndex
CREATE INDEX "session_override_events_sessionId_createdAt_idx" ON "session_override_events"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "bills_customerId_idx" ON "bills"("customerId");

-- CreateIndex
CREATE INDEX "payments_billId_idx" ON "payments"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_businessDayKey_key" ON "daily_reports"("businessDayKey");

-- CreateIndex
CREATE INDEX "daily_reports_businessDayKey_idx" ON "daily_reports"("businessDayKey");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closing_date_key" ON "daily_closing"("date");

-- CreateIndex
CREATE INDEX "daily_closing_date_idx" ON "daily_closing"("date");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

-- CreateIndex
CREATE INDEX "expense_categories_name_idx" ON "expense_categories"("name");

-- CreateIndex
CREATE INDEX "expense_entries_date_mode_idx" ON "expense_entries"("date", "mode");

-- CreateIndex
CREATE INDEX "expense_entries_categoryId_idx" ON "expense_entries"("categoryId");

-- CreateIndex
CREATE INDEX "expense_entries_createdBy_idx" ON "expense_entries"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "users_name_idx" ON "users"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_pinHash_key" ON "users"("pinHash");

-- CreateIndex
CREATE UNIQUE INDEX "report_chart_configs_targetKey_key" ON "report_chart_configs"("targetKey");

-- CreateIndex
CREATE INDEX "report_chart_configs_tableId_idx" ON "report_chart_configs"("tableId");
