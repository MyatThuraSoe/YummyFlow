export interface MenuOption { id: string; name: string; price: string; isAvailable: boolean }
export interface ModifierGroup { id: string; name: string; required: boolean; minSelect: number; maxSelect: number | null; options: MenuOption[] }
export interface Variant { id: string; name: string; priceAdjust: string; isAvailable: boolean }
export interface MenuItem { id: string; name: string; description: string | null; price: string; isAvailable: boolean; station: string; variants: Variant[]; modifierGroups: ModifierGroup[] }
export interface Category { id: string; name: string; items: MenuItem[] }
export interface TableRow { id: string; number: number; name: string | null; status: string; capacity: number; zone: string }
export interface Settings { restaurant: { currency: string; taxRate: string; taxInclusive: boolean; serviceChargePct: string } | null }

export interface ServerLine { id: string; menuItemId: string; itemNameSnapshot: string; variantSnapshot: string | null; unitPriceSnapshot: string; quantity: number; lineTotal: string; isVoided: boolean; notes: string | null; servedQuantity?: number; modifiers: { id: string; nameSnapshot: string; priceSnapshot: string }[] }
export interface OrderShape {
  id: string; orderNumber: number; total: string; subtotal: string; taxAmount: string; serviceCharge: string; discountAmount: string; amountPaid: string; paymentStatus: string;
  status: string; priority?: string; channel: string; tableId: string | null; lines: ServerLine[];
  tableSession?: { table: { number: number; name: string | null } } | null;
}

export type Tender = { method: string; amount: number; cashReceived?: number; reference?: string | null };
