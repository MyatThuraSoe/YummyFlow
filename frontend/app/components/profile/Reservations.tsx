import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchReservations, updateResStatus } from "@/lib/api";
import { CalendarX2 } from "lucide-react";
import toast from "react-hot-toast";
import { authClient } from "@/lib/auth-client";
import Loader from "@/components/global/Loader";
import { useLocation } from "react-router";
import CustomPagination from "@/components/global/CustomPagination";
import { useState } from "react";
import ReservationCard, { type BookingStatus } from "./ReservationCard";

const Reservations = () => {
  const [page, setPage] = useState(1);
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  // Determine if the current viewer is an admin/manager
  const isAdmin =
    session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const userId = session?.user.id;
  const isProfile = pathname.includes("profile");
  // if it's profile page and is admin use userId, otherwise fetch all reservations for admin dashboard
  const userid = isProfile ? userId : isAdmin ? undefined : userId;

  // 1. Fetch Reservations
  const {
    data: reservations,
    isLoading,
    isError,
  } = useQuery({
    // `page` and `userid` BOTH belong in the key. With only `userId` here, page 2
    // served the page-1 response out of the cache, and the admin "all
    // reservations" view and the profile "my reservations" view collided on one
    // entry because the differing value was `userid`, not the keyed `userId`.
    queryKey: ["reservations", userid ?? "all", page],
    queryFn: () =>
      fetchReservations({
        userId: userid,
        page,
      }),
  });

  const updateMutation = useMutation({
    mutationFn: updateResStatus,
    onSuccess: () => {
      toast.success("Reservation status updated!");
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      // Also invalidate tables so the floor plan instantly reflects if someone was checked in!
      queryClient.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update status.");
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Loader title="Loading Reservations" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-20 text-center text-red-500 font-semibold">
        Failed to load reservations. Please try again.
      </div>
    );
  }

  if (reservations?.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-border rounded-3xl bg-slate-50/50 dark:bg-muted/20">
        <div className="bg-white dark:bg-card p-4 rounded-full shadow-sm mb-4 text-slate-400">
          <CalendarX2 className="w-10 h-10" />
        </div>
        <h3 className="text-xl font-bold text-foreground mb-1">
          No Reservations Found
        </h3>
        <p className="text-sm text-muted-foreground">
          {userId
            ? "You have no upcoming table bookings."
            : "There are no reservations in the system."}
        </p>
      </div>
    );
  }

  const handleUpdateStatus = (id: string, newStatus: BookingStatus) => {
    updateMutation.mutate({ id, status: newStatus });
  };

  return (
    <div className="animate-in fade-in duration-500 w-full max-w-7xl mx-auto">
      {/* Optional Header if Admin */}
      {isProfile && (
        <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-8">
          Reservations History
        </h3>
      )}
      {!isProfile && isAdmin && (
        <div className="mb-6 flex justify-between items-end">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-foreground">
              All Reservations
            </h2>
            <p className="text-sm text-muted-foreground font-medium mt-1">
              Manage guest bookings and statuses
            </p>
          </div>
        </div>
      )}
      {/* Render the Cards */}
      <div className="space-y-4">
        {reservations?.data.map((res) => (
          <ReservationCard
            key={res.id}
            reservation={res}
            isAdmin={isAdmin} // Automatically shows dropdowns if they are an admin
            isUpdating={
              updateMutation.isPending &&
              updateMutation.variables?.id === res.id
            }
            onUpdateStatus={handleUpdateStatus}
          />
        ))}
        {reservations?.data && reservations?.data.length > 0 && (
          <CustomPagination
            currentPage={reservations?.currentPage || 1}
            totalPages={reservations?.totalPages || 1}
            loading={isLoading}
            setPage={setPage}
          />
        )}
      </div>
    </div>
  );
};

export default Reservations;
