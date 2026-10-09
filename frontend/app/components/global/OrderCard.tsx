import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ChefHat,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ShoppingBag,
  User,
  CreditCard,
  Ban,
  PlayCircle,
  BellRing,
  Printer,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import type { Order, OrderStatus } from "@/type";
import { useLocation } from "react-router";
import { Receipt } from "@/components/receipt/Receipt";
import { useReprint } from "@/components/receipt/useReprint";

/**
 * The next step in the order's life, phrased as the action a person takes.
 *
 * Changing a status used to mean expanding the card, opening a dropdown and
 * picking from five enum values — three taps and a decision, every time, in the
 * middle of service. The common case is now a single named button.
 */
const NEXT_STEP: Partial<
  Record<OrderStatus, { status: OrderStatus; label: string; icon: typeof Clock }>
> = {
  PENDING: { status: "PREPARING", label: "Start preparing", icon: PlayCircle },
  PREPARING: { status: "READY", label: "Mark ready", icon: BellRing },
  READY: { status: "SERVED", label: "Mark served", icon: CheckCircle2 },
};

interface OrderCardProps {
  order: Order;
  isAdmin?: boolean;
  isUpdating?: boolean;
  /**
   * Reprinting is allowed for STAFF as well as ADMIN/MANAGER — waiters reprint
   * chits far more often than managers do, and it changes nothing.
   */
  canReprint?: boolean;
  onUpdateOrder?: (orderId: string, field: string, value: string) => void;
}

const OrderCard = ({
  order,
  isAdmin,
  isUpdating,
  canReprint,
  onUpdateOrder,
}: OrderCardProps) => {
  const { pathname } = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);
  const isProfile = pathname.includes("profile");
  const { reprint, busyId, receiptRef, receiptData } = useReprint();

  // Status mapping for colors and icons
  const getStatusConfig = () => {
    if (order.status === "CANCELLED" || order.paymentStatus === "FAILED") {
      return {
        color: "bg-red-500",
        bg: "bg-red-50",
        icon: XCircle,
        text: "has been cancelled",
      };
    }
    if (order.status === "SERVED" && order.paymentStatus === "PAID") {
      return {
        color: "bg-emerald-500",
        bg: "bg-emerald-50",
        icon: CheckCircle2,
        text: "has been completed successfully",
      };
    }
    if (order.status === "PREPARING" || order.status === "READY") {
      return {
        color: "bg-blue-500",
        bg: "bg-blue-50",
        icon: ChefHat,
        text: `is currently ${order.status.toLowerCase()}`,
      };
    }
    return {
      color: "bg-amber-500",
      bg: "bg-amber-50",
      icon: Clock,
      text: "is pending review",
    };
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div className="rounded-lg p-6 shadow-sm border transition-all mb-4">
      {/* Header Section (Always Visible) */}
      <div className="flex justify-between items-start">
        <div className="flex gap-4">
          <div
            className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center text-white shrink-0 shadow-sm",
              config.color,
            )}
          >
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-foreground text-base tracking-tight">
              Order #{order.id}
            </h3>
            <p className="text-sm text-muted-foreground font-medium">
              {config.text}
            </p>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 mt-2 transition-colors uppercase tracking-wider"
            >
              See Detail{" "}
              {isExpanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>
        <div className="text-right flex flex-col items-end gap-2">
          <span className="text-xs text-muted-foreground font-medium">
            {formatDistanceToNow(new Date(order.createdAt), {
              addSuffix: true,
            })}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-xl font-black">
              {formatMoney(order.totalAmount)}
            </span>
            <Badge
              variant="secondary"
              className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg"
            >
              {order.paymentMethod}
            </Badge>
            {canReprint && (
              <button
                type="button"
                disabled={busyId === order.id}
                onClick={() => void reprint(order.id)}
                title="Reprint receipt"
                aria-label={`Reprint receipt for order ${order.id}`}
                className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <Printer
                  className={cn(
                    "w-3.5 h-3.5",
                    busyId === order.id && "animate-pulse",
                  )}
                />
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Expanded Details Section */}
      {isExpanded && (
        <div className="mt-6 pt-6">
          {/* CUSTOMER INFO: Only visible on Admin Dashboard */}
          {isAdmin && !isProfile && (
            <div className="ml-16 mb-6 flex items-center gap-3 p-3 rounded-lg border">
              <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                {order.user?.image ? (
                  <img
                    src={order.user.image}
                    alt={order.user.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-4 h-4 text-slate-400" />
                )}
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">
                  {order.user ? order.user.name : "Guest Order"}
                </p>
                {order.user?.email && (
                  <p className="text-xs text-muted-foreground">
                    {order.user.email}
                  </p>
                )}
              </div>
            </div>
          )}
          {/* Items List */}
          <div className="space-y-4 mb-6 border rounded-lg ml-16 p-4">
            <h1 className="text-lg font-bold">Order Items</h1>
            {order.items.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "flex justify-between items-start border-b pb-1.5",
                  // last item should not have border
                  item.id === order.items[order.items.length - 1].id &&
                    "border-b-0 pb-0",
                )}
              >
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                    {item.menuItem.image ? (
                      <img
                        src={item.menuItem.image}
                        alt={item.menuItem.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ShoppingBag className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold">{item.menuItem.name}</h4>
                    {item.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Note: {item.notes}
                      </p>
                    )}
                    <p className="text-xs font-semibold text-slate-500 mt-1">
                      {formatMoney(item.price)}{" "}
                      <span className="text-slate-300 mx-1">×</span>{" "}
                      {item.quantity}
                    </p>
                  </div>
                </div>
                <span className="text-sm font-bold">
                  {formatMoney(item.price * item.quantity)}
                </span>
              </div>
            ))}
          </div>
          {/* ADMIN CONTROLS: Only visible on the Admin Dashboard */}
          {isAdmin && !isProfile && (
            <div className="ml-16 p-4 rounded-lg border space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-orange-500" /> Order controls
              </h4>

              {/* Primary actions — one tap, no dropdown */}
              <div className="flex flex-wrap gap-2">
                {(() => {
                  const step = NEXT_STEP[order.status];
                  if (!step) return null;
                  const Icon = step.icon;
                  return (
                    <Button
                      size="sm"
                      disabled={isUpdating}
                      onClick={() => onUpdateOrder?.(order.id, "status", step.status)}
                      className="h-10 px-4 font-bold gap-2"
                    >
                      <Icon className="w-4 h-4" />
                      {step.label}
                    </Button>
                  );
                })()}

                {order.paymentStatus !== "PAID" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isUpdating}
                    onClick={() => onUpdateOrder?.(order.id, "paymentStatus", "PAID")}
                    className="h-10 px-4 font-bold gap-2"
                  >
                    <CreditCard className="w-4 h-4" />
                    Mark paid
                  </Button>
                )}

                {order.status !== "CANCELLED" && order.status !== "SERVED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isUpdating}
                    onClick={() => onUpdateOrder?.(order.id, "status", "CANCELLED")}
                    className="h-10 px-4 font-bold gap-2 text-destructive hover:bg-destructive/10"
                  >
                    <Ban className="w-4 h-4" />
                    Cancel
                  </Button>
                )}
              </div>

              {/* Corrections that are rare during service, kept out of the way */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Order Status
                  </label>
                  <Select
                    value={order.status}
                    onValueChange={(val) =>
                      onUpdateOrder?.(order.id, "status", val)
                    }
                  >
                    <SelectTrigger className="h-9 text-xs bg-white dark:bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "PENDING",
                        "PREPARING",
                        "READY",
                        "SERVED",
                        "CANCELLED",
                      ].map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Payment Status
                  </label>
                  <Select
                    value={order.paymentStatus}
                    onValueChange={(val) =>
                      onUpdateOrder?.(order.id, "paymentStatus", val)
                    }
                  >
                    <SelectTrigger className="h-9 text-xs bg-white dark:bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["PENDING", "PAID", "FAILED"].map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Order Type
                  </label>
                  <Select
                    value={order.orderType}
                    onValueChange={(val) =>
                      onUpdateOrder?.(order.id, "orderType", val)
                    }
                  >
                    <SelectTrigger className="h-9 text-xs bg-white dark:bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["DINE_IN", "TAKEAWAY", "DELIVERY"].map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Pay Method
                  </label>
                  <Select
                    value={order.paymentMethod}
                    onValueChange={(val) =>
                      onUpdateOrder?.(order.id, "paymentMethod", val)
                    }
                  >
                    <SelectTrigger className="h-9 text-xs bg-white dark:bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["CASH", "CARD"].map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hidden printable chit for this card's reprint button. */}
      {receiptData && <Receipt ref={receiptRef} data={receiptData} />}
    </div>
  );
};

export default OrderCard;
