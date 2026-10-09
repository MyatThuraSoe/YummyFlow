import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  User as UserIcon,
  ShoppingBag,
  CalendarDays,
  LogOut,
  Home,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Link } from "react-router";
import type { Route } from "../+types/home";
import Orders from "@/components/global/Orders";
import Reservations from "@/components/profile/Reservations";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Profile" },
    { name: "description", content: "Welcome to your profile!" },
  ];
}

const Profile = () => {
  const { data: session } = authClient.useSession();
  const [activeTab, setActiveTab] = useState("info");

  const handleLogout = async () => {
    await authClient.signOut();
    window.location.href = "/";
  };

  return (
    <div className="flex-1 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden flex flex-col md:flex-row shadow-sm min-h-[96vh] max-w-7xl mx-auto">
      {/* Left inner panel: User Card & Sub-menu */}
      <div className="w-full md:w-75 p-8 border-r border-slate-100">
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-28 h-28 rounded-full bg-slate-200 overflow-hidden mb-4 shadow-sm border-4 border-white">
            {session?.user?.image ? (
              <img
                src={session.user.image}
                alt={session.user.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <UserIcon className="w-full h-full p-6 text-slate-400" />
            )}
          </div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            {session?.user?.name || "Roland Donald"}
          </h2>
          <p className="text-sm font-medium text-slate-400 mt-1 uppercase tracking-widest">
            {session?.user?.role || "Customer"}
          </p>
        </div>
        <div className="space-y-2">
          <Link
            to="/"
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-bold text-sm hover:bg-slate-50 hover:dark:bg-slate-800/50"
          >
            <Home className="w-4 h-4 mr-2" />
            Home
          </Link>
          <SubMenuButton
            icon={UserIcon}
            label="Personal Information"
            active={activeTab === "info"}
            onClick={() => setActiveTab("info")}
          />
          <SubMenuButton
            icon={ShoppingBag}
            label="Orders"
            active={activeTab === "Orders"}
            onClick={() => setActiveTab("Orders")}
          />
          <SubMenuButton
            icon={CalendarDays}
            label="Reservations"
            active={activeTab === "Reservations"}
            onClick={() => setActiveTab("Reservations")}
          />
          <SubMenuButton
            icon={LogOut}
            label="Log Out"
            active={false}
            onClick={handleLogout}
          />
        </div>
      </div>
      {/* Right inner panel: The actual dynamic content */}
      <div className="flex-1 p-8 overflow-y-auto h-200">
        {/* TAB: PERSONAL INFORMATION */}
        {activeTab === "info" && (
          <div className="animate-in fade-in duration-300">
            <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-8">
              Personal Information
            </h3>

            <div className="grid grid-cols-2 gap-x-6 gap-y-8">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase ml-1">
                  First Name
                </label>
                <Input
                  defaultValue={session?.user?.name?.split(" ")[0]}
                  className="h-12 bg-slate-50 border-none rounded-xl font-medium"
                  disabled
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase ml-1">
                  Last Name
                </label>
                <Input
                  defaultValue={session?.user?.name?.split(" ")[1]}
                  className="h-12 bg-slate-50 border-none rounded-xl font-medium"
                />
              </div>

              <div className="space-y-2 col-span-2 relative">
                <label className="text-xs font-bold text-slate-400 uppercase ml-1">
                  Email
                </label>
                <Input
                  defaultValue={session?.user?.email}
                  disabled
                  className="h-12 bg-slate-50 border-none rounded-xl font-medium"
                />
                {session?.user?.emailVerified && (
                  <span className="absolute right-4 top-10 flex items-center gap-1 text-xs font-bold text-emerald-500">
                    <CheckCircle2 className="w-4 h-4" /> Verified
                  </span>
                )}
              </div>

              <div className="space-y-2 col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase ml-1">
                  Address
                </label>
                <Input
                  placeholder="Enter your address"
                  className="h-12 bg-slate-50 border-none rounded-xl font-medium"
                />
              </div>
            </div>
            <div className="flex gap-4 mt-12">
              <Button
                variant="outline"
                className="flex-1 h-12 rounded-xl text-orange-500 border-orange-200 hover:bg-orange-50 hover:text-orange-600 font-bold"
              >
                Discard Changes
              </Button>
              <Button className="flex-1 h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold">
                Save Changes
              </Button>
            </div>
          </div>
        )}

        {/* TAB: ORDERS */}
        {activeTab === "Orders" && <Orders />}

        {/* TAB: RESERVATIONS */}
        {activeTab === "Reservations" && <Reservations />}
      </div>
    </div>
  );
};

function SubMenuButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: ({ label }: { label: string }) => void;
}) {
  return (
    <button
      onClick={() => onClick({ label })}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-bold text-sm",
        active
          ? "bg-orange-50 dark:bg-orange-950/30 text-orange-600"
          : "text-slate-500 hover:bg-slate-50 hover:dark:bg-slate-800/50",
      )}
    >
      <Icon className="w-5 h-5" /> {label}
    </button>
  );
}

export default Profile;
