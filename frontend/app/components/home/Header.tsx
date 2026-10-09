import { Utensils } from "lucide-react";
import Theme from "@/components/sidebar/Theme";
import { authClient } from "@/lib/auth-client";
import { Link } from "react-router";
import { CartSheet } from "../global/OrderSummary";

const Header = () => {
  const { data } = authClient.useSession();
  const isAdminOrManager =
    data?.user.role === "ADMIN" || data?.user.role === "MANAGER";
  const isStaff = data?.user.role === "STAFF" || data?.user.role === "KITCHEN";
  return (
    <div className="relative z-50 w-full lg:max-w-[80%] mx-auto px-8 lg:px-12 py-8 flex items-center justify-between">
      <div className="flex items-center gap-2 group cursor-pointer">
        <div className="size-6 lg:size-10 rounded-full bg-[#241006] dark:bg-white flex items-center justify-center transition-transform group-hover:rotate-12">
          <Utensils className="text-white dark:text-primary size-4 lg:size-6" />
        </div>
        <span className="text-lg lg:text-2xl font-black tracking-tighter uppercase text-[#241006] dark:text-white">
          Dine Flow
        </span>
      </div>
      <div className="hidden lg:flex items-center gap-10">
        <a
          href="#menu"
          className="text-sm font-bold text-[#241006]/70 dark:text-white/70 hover:text-[#241006] dark:hover:text-white transition-colors"
        >
          Menu +
        </a>
        <a
          href="#about"
          className="text-sm font-bold text-[#241006]/70 dark:text-white/70 hover:text-[#241006] dark:hover:text-white transition-colors"
        >
          About Us
        </a>
        <a
          href="#locations"
          className="text-sm font-bold text-[#241006]/70 dark:text-white/70 hover:text-[#241006] dark:hover:text-white transition-colors"
        >
          Locations
        </a>
        <a
          href="#resources"
          className="text-sm font-bold text-[#241006]/70 dark:text-white/70 hover:text-[#241006] dark:hover:text-white transition-colors"
        >
          Resources
        </a>
        <a
          href="#contact"
          className="text-sm font-bold text-[#241006]/70 dark:text-white/70 hover:text-[#241006] dark:hover:text-white transition-colors"
        >
          Contact Us
        </a>
      </div>

      <div className="flex items-center gap-4">
        <Theme />
        {!data?.session && (
          <Link
            to="/signin"
            className="bg-[#241006] dark:bg-white text-white dark:text-primary px-4 py-2 rounded-full text-sm font-bold uppercase tracking-widest hover:scale-105 transition-all shadow-lg"
          >
            Sign In
          </Link>
        )}
        {data?.session && (
          <>
            {data?.user.role !== "CUSTOMER" && (
              <Link
                to="/dashboard"
                className="bg-[#241006] dark:bg-white text-white dark:text-primary px-4 py-2 rounded-full text-sm font-bold uppercase tracking-widest hover:scale-105 transition-all shadow-lg"
              >
                {isStaff && "POS"}
                {isAdminOrManager && "Admin"}
              </Link>
            )}
            {data.user.image === "" && (
              <Link
                to={`/profile/${data.user.id}`}
                className="text-sm font-medium text-[#241006] dark:text-white"
              >
                Welcome, {data.user.name}
              </Link>
            )}
            <CartSheet />
            {data.user.image !== "" && (
              <Link to={`/profile/${data.user.id}`}>
                <img
                  src={data.user.image || ""}
                  alt="Profile"
                  className="size-8 rounded-full border-2 border-[#241006] dark:border-white"
                />
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Header;
