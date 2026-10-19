-- CreateTable
CREATE TABLE "ReceiptConfig" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "showShopName" BOOLEAN NOT NULL DEFAULT true,
    "showLogo" BOOLEAN NOT NULL DEFAULT false,
    "logo" TEXT,
    "showAddress" BOOLEAN NOT NULL DEFAULT false,
    "showPhone" BOOLEAN NOT NULL DEFAULT false,
    "headerText" TEXT,
    "footerText" TEXT,
    "thankYouText" TEXT,
    "showOrderNumber" BOOLEAN NOT NULL DEFAULT true,
    "showTable" BOOLEAN NOT NULL DEFAULT true,
    "showDateTime" BOOLEAN NOT NULL DEFAULT true,
    "showCashier" BOOLEAN NOT NULL DEFAULT true,
    "showSubtotal" BOOLEAN NOT NULL DEFAULT true,
    "showServiceCharge" BOOLEAN NOT NULL DEFAULT true,
    "showTax" BOOLEAN NOT NULL DEFAULT true,
    "showDiscount" BOOLEAN NOT NULL DEFAULT true,
    "showTotal" BOOLEAN NOT NULL DEFAULT true,
    "showPaymentMethod" BOOLEAN NOT NULL DEFAULT true,
    "showAmountPaid" BOOLEAN NOT NULL DEFAULT true,
    "showChange" BOOLEAN NOT NULL DEFAULT true,
    "showModifiers" BOOLEAN NOT NULL DEFAULT true,
    "paperWidth" INTEGER NOT NULL DEFAULT 80,
    "fontSize" TEXT NOT NULL DEFAULT 'medium',
    "alignment" TEXT NOT NULL DEFAULT 'left',
    "showQrCode" BOOLEAN NOT NULL DEFAULT false,
    "qrContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptConfig_restaurantId_key" ON "ReceiptConfig"("restaurantId");

-- AddForeignKey
ALTER TABLE "ReceiptConfig" ADD CONSTRAINT "ReceiptConfig_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
