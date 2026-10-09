import { Link } from "react-router";
import { XCircle, ArrowLeft, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Route } from "../+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Cancelled" },
    { name: "description", content: "Welcome to Cancelled!" },
  ];
}
// purely designs => ai's work
export default function CheckoutCancel() {
  return (
    <div className="min-h-screen bg-[#f8f9fc] dark:bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-card rounded-3xl shadow-xl overflow-hidden text-center border border-border">
        {/* Top Accent Graphic */}
        <div className="bg-red-500 h-32 flex items-end justify-center relative overflow-hidden">
          <div className="bg-white dark:bg-card rounded-full p-2 translate-y-1/2 shadow-sm mb-14">
            <div className="bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-full">
              <XCircle className="w-12 h-12" />
            </div>
          </div>
        </div>

        <div className="pt-16 pb-8 px-6">
          <h1 className="text-2xl font-black tracking-tight text-foreground mb-2">
            Payment Cancelled
          </h1>
          <p className="text-muted-foreground text-sm mb-6">
            Your checkout process was interrupted. Don't worry, your card has{" "}
            <span className="font-bold text-foreground">not</span> been charged.
          </p>

          <div className="bg-red-50 dark:bg-red-950/20 rounded-2xl p-4 mb-8 border border-red-100 dark:border-red-900/30 text-sm text-red-800 dark:text-red-300">
            Your cart is still saved! You can try a different payment method
            whenever you're ready.
          </div>

          <div className="space-y-3">
            <Button
              asChild
              className="w-full h-12 rounded-xl text-sm font-bold tracking-widest uppercase gap-2 text-white"
            >
              <Link to="/">
                {" "}
                {/* Change this to wherever your cart/checkout route is */}
                <ShoppingCart className="w-4 h-4" /> Try Checking Out Again
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              className="w-full h-12 rounded-xl text-sm font-bold tracking-widest uppercase gap-2 text-muted-foreground hover:text-foreground"
            >
              <Link to="/">
                <ArrowLeft className="w-4 h-4" /> Back to Menu
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
