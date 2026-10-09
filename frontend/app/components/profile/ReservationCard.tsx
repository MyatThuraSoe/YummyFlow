import {
  CalendarDays,
  Clock,
  Users,
  MapPin,
  CheckCircle2,
  XCircle,
  AlertCircle,
  CalendarClock,
} from "lucide-react";
import { format } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useLocation } from "react-router";
import type { Reservation } from "@/type";

export type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED";

interface ReservationCardProps {
  reservation: Reservation;
  isAdmin?: boolean;
  onUpdateStatus?: (id: string, newStatus: BookingStatus) => void;
  isUpdating?: boolean;
}

const ReservationCard = ({
  reservation,
  isAdmin,
  onUpdateStatus,
  isUpdating,
}: ReservationCardProps) => {
  const dateObj = new Date(reservation.date);
  const { pathname } = useLocation();
  const isProfile = pathname.includes("profile");

  // Status mapping for colors and icons
  const getStatusConfig = () => {
    switch (reservation.status) {
      case "CONFIRMED":
        return {
          color: "bg-blue-500",
          bg: "bg-blue-50",
          text: "text-blue-600",
          icon: CalendarClock,
          label: "Confirmed",
        };
      case "COMPLETED":
        return {
          color: "bg-green-500",
          bg: "bg-green-50",
          text: "text-white",
          icon: CheckCircle2,
          label: "Confirmed",
        };
      case "CANCELLED":
        return {
          color: "bg-red-500",
          bg: "bg-red-50",
          text: "text-red-600",
          icon: XCircle,
          label: "Cancelled",
        };
      default: // PENDING
        return {
          color: "bg-amber-500",
          bg: "bg-amber-50",
          text: "text-amber-600",
          icon: Clock,
          label: "Pending Review",
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "rounded-lg p-6 shadow-sm border transition-all mb-4",
        isUpdating && "opacity-60 pointer-events-none",
      )}
    >
      {/* Top Section */}
      <div className="flex justify-between items-start mb-6">
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
              {format(dateObj, "EEEE, MMMM do, yyyy")}
            </h3>
            <p className={cn("text-sm font-bold mt-0.5", config.text)}>
              {config.label}
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-2xl font-black text-foreground">
            {format(dateObj, "h:mm a")}
          </span>
        </div>
      </div>
      {/* Details Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 rounded-lg border">
        <div className="flex items-center gap-3">
          <div className="bg-white dark:bg-card p-2 rounded-lg shadow-sm text-primary">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Party Size
            </p>
            <p className="text-sm font-semibold">{reservation.guests} Guests</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-white dark:bg-card p-2 rounded-lg shadow-sm text-primary">
            <MapPin className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Table / Area
            </p>
            <p className="text-sm font-semibold">
              {reservation.table?.name || "TBA"} •{" "}
              {reservation.table?.section || "Dining"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 col-span-2 md:col-span-1">
          <div className="bg-white dark:bg-card p-2 rounded-lg shadow-sm text-primary">
            <CalendarDays className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Reserved Under
            </p>
            <p className="text-sm font-semibold">{reservation.customerName}</p>
          </div>
        </div>
      </div>
      {/* Admin Controls */}
      {isAdmin && !isProfile && (
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-orange-500" /> Admin Controls
          </span>
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-muted-foreground">
              Update Status:
            </label>
            <Select
              value={reservation.status}
              onValueChange={(val) =>
                onUpdateStatus?.(reservation.id, val as BookingStatus)
              }
            >
              <SelectTrigger className="h-9 w-35 text-xs font-bold bg-white dark:bg-card shadow-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"].map((s) => (
                  <SelectItem key={s} value={s} className="text-xs font-bold">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReservationCard;
