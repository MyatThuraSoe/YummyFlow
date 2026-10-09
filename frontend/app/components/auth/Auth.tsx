import { Utensils } from "lucide-react";
import { useLocation, Link } from "react-router";
import { useState } from "react";
import Socials from "./Socials";
import Form from "./Form";

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const pathName = useLocation().pathname;
  const isSignUp = pathName === "/signup";
  return (
    <div className="flex-1 p-8 md:p-16 flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-3 mb-12 group">
          <div className="w-10 h-10 rounded-2xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/20 group-hover:rotate-12 transition-transform">
            <Utensils className="text-white w-6 h-6" />
          </div>
          <span className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white">
            DineFlow
          </span>
        </div>
        <h1 className="text-4xl font-black text-slate-900 dark:text-white mb-4 leading-[1.1] tracking-tight">
          Welcome back to <br />{" "}
          <span className="text-primary">your kitchen.</span>
        </h1>
        <p className="text-slate-400 dark:text-slate-500 text-sm mb-10 max-w-sm leading-relaxed font-medium">
          Sign in to manage your reservations, floor plan, and real-time
          analytics.
        </p>
        <Socials isLoading={isLoading} setIsLoading={setIsLoading} />
        <div className="relative mb-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-100 dark:border-slate-800"></div>
          </div>
          <div className="relative flex justify-center text-[10px] font-black uppercase tracking-widest">
            <span className="px-4 bg-white dark:bg-slate-900 text-slate-400">
              Or use credentials
            </span>
          </div>
        </div>
        <Form isLoading={isLoading} setIsLoading={setIsLoading} />
      </div>
      <p className="text-center text-xs font-bold text-slate-400 mt-8">
        {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
        <Link
          to={isSignUp ? "/signin" : "/signup"}
          className="text-primary font-black hover:underline"
        >
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
};

export default Auth;
