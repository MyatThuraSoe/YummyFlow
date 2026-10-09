import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Empty from "@/components/global/Empty";
import OrderCard from "@/components/global/OrderCard";
import { useState } from "react";
import { getOrders, updateOrderDetails } from "@/lib/api";
import Loader from "@/components/global/Loader";
import CustomPagination from "@/components/global/CustomPagination";
import { ShoppingBag } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import toast from "react-hot-toast";
import { useLocation } from "react-router";
import { qk, tableDependentKeys } from "@/lib/query-keys";
import type { Order } from "@/type";

type OrdersPage = {
  data: Order[];
  totalOrders?: number;
  totalItems?: number;
  currentPage: number;
  totalPages: number;
};

const Orders = () => {
  const [page, setPage] = useState(1);
  const { pathname } = useLocation();
  const { data: session } = authClient.useSession();
  // Determine if the current viewer is an admin/manager
  const role = session?.user?.role;
  const isAdmin = role === "ADMIN" || role === "MANAGER";
  // STAFF work the floor and reprint chits; KITCHEN and CUSTOMER do not.
  const canReprint = isAdmin || role === "STAFF";
  const userId = session?.user.id;
  const isProfile = pathname.includes("profile");
  // if it's profile page and is admin use userId, otherwise fetch all reservations for admin dashboard
  const userid = isProfile ? userId : isAdmin ? undefined : userId;

  const queryClient = useQueryClient();
  const listKey = qk.orders.list(userid, page);

  const {
    data: orders,
    isLoading,
    isError,
  } = useQuery({
    queryKey: listKey,
    queryFn: () =>
      getOrders({
        args: {
          userId: userid,
          page,
        },
      }) as Promise<OrdersPage>,
  });

  // The mutation to handle updates
  const updateMutation = useMutation({
    mutationFn: updateOrderDetails,

    // Reflect the change straight away — a cashier tapping "Mark ready" should
    // not watch the card sit unchanged for a round-trip.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<OrdersPage>(listKey);

      queryClient.setQueryData<OrdersPage>(listKey, (old) =>
        old
          ? {
              ...old,
              data: old.data.map((order) =>
                order.id === vars.id
                  ? { ...order, [vars.field]: vars.value }
                  : order,
              ),
            }
          : old,
      );

      return { previous };
    },

    onError: (error: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(listKey, ctx.previous);
      toast.error(error.message || "Failed to update order");
    },

    onSuccess: () => {
      toast.success("Order updated");
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orders.all });
      // A cancelled or served order can change what the floor plan shows.
      void queryClient.invalidateQueries({ queryKey: tableDependentKeys });
    },
  });

  const handleUpdateOrder = (orderId: string, field: string, value: string) => {
    // Prevent spam clicking while already updating
    if (updateMutation.isPending) return;
    updateMutation.mutate({ id: orderId, field, value });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Loader title="Loading Orders" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-20 text-center text-red-500 font-semibold">
        Failed to load orders. Please try again.
      </div>
    );
  }

  const total = orders?.totalOrders ?? orders?.totalItems ?? 0;

  if (!orders || total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-border rounded-3xl bg-slate-50/50 dark:bg-muted/20">
        <div className="bg-white dark:bg-card p-4 rounded-full shadow-sm mb-4 text-slate-400">
          <ShoppingBag className="w-10 h-10" />
        </div>
        <h3 className="text-xl font-bold text-foreground mb-1">
          No orders yet
        </h3>
        <p className="text-sm text-muted-foreground">
          {userid
            ? "You have not placed any orders."
            : "No orders have been placed in the system."}
        </p>
      </div>
    );
  }

  return (
    <div>
      {isProfile && (
        <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-8">
          Order History
        </h3>
      )}
      {!isProfile && isAdmin && (
        <div className="mb-6 flex justify-between items-end">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-foreground">
              All Orders
            </h2>
            <p className="text-sm text-muted-foreground font-medium mt-1">
              {total.toLocaleString()} {total === 1 ? "order" : "orders"}
            </p>
          </div>
        </div>
      )}

      {orders.data.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          isAdmin={isAdmin}
          canReprint={canReprint}
          isUpdating={
            updateMutation.isPending &&
            updateMutation.variables?.id === order.id
          }
          onUpdateOrder={handleUpdateOrder}
        />
      ))}

      <CustomPagination
        currentPage={orders.currentPage || 1}
        totalPages={orders.totalPages || 1}
        loading={isLoading}
        setPage={setPage}
      />
    </div>
  );
};

export default Orders;
