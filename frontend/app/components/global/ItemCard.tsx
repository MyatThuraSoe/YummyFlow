import { customFetch } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useEdgeStore } from "@/lib/useEdgestore";
import { formatMoney } from "@/lib/currency";
import ReviewDialog from "@/components/menu/ReviewDialog";
import { homeCart, posCart } from "@/store";
import type { itemsProps } from "@/type";
import { useMutation } from "@tanstack/react-query";
import { Edit, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Link, useLocation } from "react-router";

const ItemCard = ({ item }: { item: itemsProps }) => {
  const [open, setOpen] = useState(false);
  const { data } = authClient.useSession();
  const { pathname } = useLocation();
  const { edgestore } = useEdgeStore();
  const canEdit = data?.user.role === "ADMIN" || data?.user.role === "MANAGER";
  // home & new-order page
  const canAddToCart = pathname.includes("new-order") || pathname === "/";
  // delete mutation
  const deleteMutation = useMutation({
    mutationFn: () =>
      customFetch(`/menu/delete/${item.id}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      if (item.image) {
        await edgestore.publicFiles.delete({
          url: item.image,
        });
      }
      toast.success("Item Deleted");
    },
    onError: () => {
      toast.error("Failed to delete.");
    },
  });

  // cart functionality
  const handleAdd = () => {
    if (pathname.includes("new-order")) {
      posCart.actions.addItem(item);
    } else {
      homeCart.actions.addItem(item);
    }
    toast.success(`${item.name} added to cart`);
  };

  return (
    <>
      <div className="group relative flex flex-col items-start transition-all duration-300 border rounded-lg p-2">
        {/* Image Container */}
        <div className="relative w-full aspect-square overflow-hidden rounded-lg bg-[#f3f3f1] dark:bg-slate-900 mb-4">
          <img
            src={item.image}
            alt={item.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 cursor-pointer"
            onClick={() => setOpen(true)}
          />
          {/* Floating Price Tag over Image */}
          <div className="absolute top-4 left-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-2xl shadow-sm">
            <span className="text-sm font-black text-[#241006] dark:text-white">
              {formatMoney(item.price)}
            </span>
          </div>
          {/* Action Buttons Overlay */}
          <div className="absolute bottom-4 right-4 flex gap-2 translate-y-4 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            {/* edit button */}
            {canEdit && (
              <Link
                to={`/admin/menu/items-categories/${item.id}`}
                className="bg-white hover:bg-white/90 text-[#241006] p-3 rounded-full shadow-xl transition-transform active:scale-95"
              >
                <Edit size={18} />
              </Link>
            )}
            {/* delete button */}
            {canEdit && (
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-white p-3 rounded-full shadow-xl transition-transform active:scale-95"
              >
                <Trash2 size={18} />
              </button>
            )}
            {canAddToCart && (
              <button
                onClick={handleAdd}
                disabled={deleteMutation.isPending}
                className="bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-white p-3 rounded-full shadow-xl transition-transform active:scale-95"
              >
                <Plus size={18} />
              </button>
            )}
          </div>
        </div>
        {/* Text Details */}
        <div className="px-2 w-full">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-black tracking-tight text-[#241006] dark:text-white uppercase leading-none">
                {item.name}
              </h2>
              {/* Reviews replace the decorative subtitle: a dish's score is
                  something a guest actually wants, "Fresh Ingredients" is
                  not — and it was the only dead space on the card. */}
              <div className="mt-1.5">
                <ReviewDialog item={item} />
              </div>
            </div>

            {item.discount > 0 && (
              <span className="text-[10px] font-black bg-primary/10 text-primary px-2 py-1 rounded-full uppercase">
                -
                {((item.discount / (item.price + item.discount)) * 100).toFixed(
                  0,
                )}
                %
              </span>
            )}
          </div>
          {/* Discount Pricing (Bottom) */}
          {item.discount > 0 && (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-muted-foreground line-through font-medium">
                {formatMoney(item.price + item.discount)}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ItemCard;
