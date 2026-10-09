import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { CheckCircle2, ChefHat, ArrowRight, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { homeCart } from "@/store"; // Adjust path to your Valtio store
import type { Route } from "../+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Success" },
    { name: "description", content: "Welcome to Success!" },
  ];
}

export default function CheckoutSuccess() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");

  // Clear the customer's cart since they just paid!
  useEffect(() => {
    homeCart.actions.reset();
  }, []);

  return (
    <div className="min-h-screen bg-[#f8f9fc] dark:bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-card rounded-lg shadow-xl overflow-hidden text-center border border-border">
        {/* Top Accent Graphic */}
        <div className="bg-emerald-500 h-32 flex items-end justify-center relative overflow-hidden">
          {/* Subtle background patterns */}
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-white to-transparent" />

          <div className="bg-white dark:bg-card rounded-full p-2 translate-y-1/2 shadow-sm mb-14">
            <div className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 p-4 rounded-full">
              <CheckCircle2 className="w-12 h-12" />
            </div>
          </div>
        </div>

        <div className="pt-16 pb-8 px-6">
          <h1 className="text-2xl font-black tracking-tight text-foreground mb-2">
            Payment Successful!
          </h1>
          <p className="text-muted-foreground text-sm mb-6">
            Thank you for your order. Your payment has been securely processed
            and sent to our kitchen.
          </p>

          <div className="bg-slate-50 dark:bg-muted/50 rounded-lg p-4 mb-8 border border-border text-left space-y-3">
            <div className="flex items-center gap-3 text-sm font-medium text-foreground">
              <ChefHat className="w-5 h-5 text-primary" />
              <span>The kitchen is preparing your food</span>
            </div>
            <div className="flex items-center gap-3 text-sm font-medium text-foreground">
              <ReceiptText className="w-5 h-5 text-primary" />
              <span>A receipt has been sent to your email</span>
            </div>
            {sessionId && (
              <div className="pt-3 mt-3 border-t border-border text-xs text-muted-foreground break-all">
                <span className="font-semibold">Ref:</span>{" "}
                {sessionId.slice(0, 20)}...
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Button
              asChild
              className="w-full h-12 rounded-xl text-sm font-bold tracking-widest uppercase"
            >
              <Link to="/">Return to Menu</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="w-full h-12 rounded-xl text-sm font-bold tracking-widest uppercase border-border"
            >
              <Link to="/profile/orders">
                View My Orders <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
