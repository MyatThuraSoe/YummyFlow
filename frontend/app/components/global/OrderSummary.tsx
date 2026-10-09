import { homeCart, posCart } from "@/store";
import { useLocation } from "react-router";
import { useSnapshot } from "valtio";
import Empty from "./Empty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Minus,
  Plus,
  Printer,
  ShoppingCart,
  StickyNote,
  Trash,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useMutation } from "@tanstack/react-query";
import { submitOrder } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import FloorPlan from "@/components/pos/FloorPlan";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  Receipt,
  usePrint,
  type ReceiptData,
} from "@/components/receipt/Receipt";

const MAX_NOTE_LENGTH = 140;

const OrderSummary = () => {
  const [isSelectingTable, setIsSelectingTable] = useState(false);
  // The printable snapshot. Held separately from the cart so the receipt stays
  // intact while `onAfterPrint` clears the cart for the next customer.
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [noteDraft, setNoteDraft] = useState<{
    lineId: string;
    value: string;
  } | null>(null);
  const { pathname } = useLocation();
  const canAddToCart = pathname.includes("new-order");

  const cart = canAddToCart ? posCart : homeCart;

  const { receiptRef, print } = usePrint({
    documentTitle: () => `Receipt-${receiptData?.orderId ?? "DineFlow"}`,
    onAfterPrint: () => {
      // 🚀 Reset the POS Cart for the next customer AFTER printing dialog closes!
      cart.actions.reset();
      setReceiptData(null);
      setNoteDraft(null);
    },
  });

  // 1. Safe Snapshot Access
  const snap = useSnapshot(canAddToCart ? posCart.state : homeCart.state);
  const items = snap.items ?? [];
  const total = snap.total ?? 0;
  const type = snap.type ?? "dine-in";
  const table = snap.table ?? null;

  // 3. Fallback Order Number (Used before DB assigns a real one)
  const fallbackOrderNumber = useMemo(
    () => `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
    [],
  );

  // =====================================================================
  // MUTATION: Submit Order to Backend
  // =====================================================================
  const orderMutation = useMutation({
    mutationFn: submitOrder,
    onSuccess: (data: any) => {
      toast.success("Order placed successfully!");

      // Snapshot everything the chit needs now, while the cart is still
      // populated — `onAfterPrint` clears it a moment later.
      setReceiptData({
        orderId: data?.id ?? fallbackOrderNumber,
        createdAt: data?.createdAt ?? new Date().toISOString(),
        orderType: type,
        tableName: table?.name ?? data?.table?.name ?? null,
        paymentMethod: data?.paymentMethod ?? null,
        total,
        lines: items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.price ?? 0,
          notes: item.notes || null,
        })),
      });

      // setTimeout gives React a fraction of a second to render the real DB
      // order id into the hidden receipt before the iframe is cloned.
      setTimeout(() => {
        print();
      }, 100);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to place order");
    },
  });

  // =====================================================================
  // Type of order (Dine-in or Takeaway)
  // =====================================================================
  const orderType = (selectedType: "dine-in" | "take-away") => {
    cart.actions.setType(selectedType);
  };

  // =====================================================================
  // HANDLER: Quantity update
  // =====================================================================
  const handleQuantityUpdate = (lineId: string, amount: number) => {
    cart.actions.updateQuantity(lineId, amount);
  };

  const removeItem = (lineId: string) => {
    cart.actions.removeItem(lineId);
    if (noteDraft?.lineId === lineId) setNoteDraft(null);
  };

  /** Persist a kitchen instruction for one line, or clear it when empty. */
  const commitNote = (lineId: string, value: string) => {
    cart.actions.setItemNotes(lineId, value.trim().slice(0, MAX_NOTE_LENGTH));
    setNoteDraft(null);
  };

  const handlePlaceOrder = () => {
    // Validation: Dine-in requires a table
    if (type === "dine-in" && !table) {
      toast.error("Please select a table for Dine-in orders.");
      setIsSelectingTable(true);
      return;
    }

    // Format data for backend. Notes travel with the line so the kitchen ticket
    // says "no onions" instead of the pass having to guess.
    const payload = {
      orderType: type === "dine-in" ? "DINE_IN" : "TAKEAWAY",
      tableId: table?.id || null,
      items: items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        notes: item.notes?.trim() || undefined,
      })),
    };

    orderMutation.mutate(payload);
  };

  return (
    <div className="w-full mt-2 flex flex-col h-full">
      <h1 className="text-2xl font-black uppercase tracking-tighter text-primary px-2">
        Order Summary
      </h1>
      {items.length === 0 ? (
        <Empty title="Order is empty" description="Add some items to start" />
      ) : (
        <>
          {/* Order Type Toggle */}
          <div className="flex gap-2 mt-4 justify-end px-2">
            <Button
              variant={type === "dine-in" ? "default" : "outline"}
              onClick={() => orderType("dine-in")}
              className="rounded-full uppercase font-bold text-xs"
            >
              Dine In
            </Button>
            <Button
              variant={type === "take-away" ? "default" : "outline"}
              onClick={() => orderType("take-away")}
              className="rounded-full uppercase font-bold text-xs"
            >
              Take Away
            </Button>
          </div>
          {/* Scrollable Items List */}
          <div className="mt-4 flex-1 overflow-y-auto px-2 space-y-2">
            {items.map((item) => (
              <div
                key={item.lineId}
                className="flex justify-between items-start border rounded-lg p-3 bg-card shadow-sm border-border/50"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <img
                    src={item.image}
                    className="size-14 rounded-xl object-cover shrink-0"
                    alt=""
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm uppercase leading-tight line-clamp-1">
                      {item.name}
                    </p>
                    <p className="font-bold text-primary text-xs">
                      {formatMoney(item.price || 0)}
                    </p>
                    <div className="flex gap-3 items-center mt-2">
                      <button
                        onClick={() => handleQuantityUpdate(item.lineId, -1)}
                        className="p-1 bg-accent rounded-md hover:bg-primary hover:text-white transition-colors"
                      >
                        <Minus className="size-3" />
                      </button>
                      <span className="font-black text-xs">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => handleQuantityUpdate(item.lineId, 1)}
                        className="p-1 bg-accent rounded-md hover:bg-primary hover:text-white transition-colors"
                      >
                        <Plus className="size-3" />
                      </button>
                    </div>

                    {/* Kitchen note for this line. Kept collapsed so a busy
                        till is not a wall of empty text boxes. */}
                    {noteDraft?.lineId === item.lineId ? (
                      <div className="mt-2 flex gap-2">
                        <Input
                          autoFocus
                          value={noteDraft.value}
                          maxLength={MAX_NOTE_LENGTH}
                          placeholder="e.g. No onions, well done"
                          className="h-8 text-xs"
                          onChange={(e) =>
                            setNoteDraft({
                              lineId: item.lineId,
                              value: e.target.value,
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              commitNote(item.lineId, noteDraft.value);
                            if (e.key === "Escape") setNoteDraft(null);
                          }}
                        />
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => commitNote(item.lineId, noteDraft.value)}
                        >
                          Save
                        </Button>
                      </div>
                    ) : item.notes ? (
                      <div className="mt-2 flex items-center gap-1 w-fit rounded-full bg-amber-100 pl-2 pr-1 py-0.5 text-[11px] font-semibold text-amber-900">
                        <StickyNote className="size-3 shrink-0" />
                        <button
                          className="max-w-[16rem] truncate text-left"
                          onClick={() =>
                            setNoteDraft({
                              lineId: item.lineId,
                              value: item.notes ?? "",
                            })
                          }
                        >
                          {item.notes}
                        </button>
                        <button
                          aria-label="Remove note"
                          className="rounded-full p-0.5 hover:bg-amber-200"
                          onClick={() => commitNote(item.lineId, "")}
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="mt-2 flex items-center gap-1 text-[11px] font-semibold uppercase opacity-50 hover:opacity-100"
                        onClick={() =>
                          setNoteDraft({ lineId: item.lineId, value: "" })
                        }
                      >
                        <StickyNote className="size-3" /> Add note
                      </button>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10 shrink-0"
                  onClick={() => removeItem(item.lineId)}
                >
                  <Trash className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* Footer Totals & Actions */}
          <div className="border-t border-border p-4 bg-background mt-auto">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm font-bold uppercase opacity-50">Total</p>
              <p className="text-3xl font-black text-primary">
                {formatMoney(total || 0)}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2 w-full">
                {canAddToCart && (
                  <>
                    {type === "dine-in" && (
                      <Button
                        variant="secondary"
                        onClick={() => setIsSelectingTable(true)}
                        disabled={orderMutation.isPending || items.length === 0}
                        className="h-14 w-fit rounded-2xl font-bold uppercase tracking-widest text-xs"
                      >
                        {table?.name ? `Table: ${table.name}` : "Select Table"}
                      </Button>
                    )}
                    <Button
                      onClick={handlePlaceOrder}
                      disabled={orderMutation.isPending || items.length === 0}
                      className={cn(
                        "h-14 w-fit rounded-2xl font-bold uppercase tracking-widest text-xs gap-2",
                        type !== "dine-in" && "w-full",
                      )}
                    >
                      {orderMutation.isPending ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <Printer className="w-4 h-4" /> Place Order
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ================================================== */}
      {/* HIDDEN PRINT UI */}
      {/* ================================================== */}
      {receiptData && <Receipt ref={receiptRef} data={receiptData} />}

      {/* ================================================== */}
      {/* MODALS */}
      {/* ================================================== */}
      <Dialog open={isSelectingTable} onOpenChange={setIsSelectingTable}>
        <DialogContent className="max-w-[95vw] lg:max-w-5xl h-[90vh] p-0 overflow-hidden border-none shadow-none">
          <div className="h-full w-full">
            <FloorPlan showHeader={false} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OrderSummary;

export const CartSheet = () => {
  const { pathname } = useLocation();
  const canAddToCart = pathname.includes("new-order");

  // 1. Safe Snapshot Access
  const { items } = useSnapshot(canAddToCart ? posCart.state : homeCart.state);

  return (
    <Sheet>
      <SheetTrigger className="flex gap-2 items-center">
        <div className="relative">
          <ShoppingCart className="size-8" />
          <span className="absolute -top-1 -right-1 bg-primary text-white text-xs font-bold rounded-full px-1.5 py-0.5">
            {items.length}
          </span>
        </div>
      </SheetTrigger>
      <SheetContent>
        <OrderSummary />
      </SheetContent>
    </Sheet>
  );
};
