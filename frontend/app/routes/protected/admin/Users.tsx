import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Ban,
  Download,
  Plus,
  Shield,
  UserCheck,
  Users as UsersIcon,
  User as UserIcon,
} from "lucide-react";
import type { Route } from "./+types/Dashboard";
import { useEffect, useMemo, useState } from "react";
import type { roles, User } from "@/type";
import StatCard from "@/components/global/StatCard";
import { authClient } from "@/lib/auth-client";
import toast from "react-hot-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import RoleBadge from "@/components/user/RoleBadge";
import Actions from "@/components/user/Actions";
import Constrols from "@/components/user/Constrols";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Users" },
    { name: "description", content: "Welcome to the Users page!" },
  ];
}

const Users = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState<roles | "ALL">("ALL");

  // fetch users
  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const response = await authClient.admin.listUsers({
        query: { limit: 100 },
      });
      if (response.data?.users) {
        setUsers(response.data.users as User[]);
      }
    } catch (error) {
      console.error("Failed to fetch users:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Filter Logic
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch =
        user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole =
        selectedRole === "ALL" ||
        (user.role?.toUpperCase() || "CUSTOMER") === selectedRole;

      return matchesSearch && matchesRole;
    });
  }, [users, searchQuery, selectedRole]);

  // Actions
  const handleSetRole = async (userId: string, newRole: roles) => {
    try {
      await authClient.admin.setRole({ userId, role: newRole });
      setUsers(
        users.map((u) => (u.id === userId ? { ...u, role: newRole } : u)),
      );
      toast.success("Role updated successfully.");
    } catch (error) {
      toast.error("Failed to update role.");
    }
  };

  const handleToggleBan = async (
    userId: string,
    isCurrentlyBanned: boolean,
  ) => {
    try {
      if (isCurrentlyBanned) {
        await authClient.admin.unbanUser({ userId });
      } else {
        await authClient.admin.banUser({ userId, banReason: "Admin action" });
      }
      setUsers(
        users.map((u) =>
          u.id === userId ? { ...u, banned: !isCurrentlyBanned } : u,
        ),
      );
      toast.success(isCurrentlyBanned ? "User unbanned." : "User banned.");
    } catch (error) {
      console.error("Failed to toggle ban status:", error);
      toast.error("Failed to toggle ban status.");
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (
      !window.confirm("Are you sure you want to permanently delete this user?")
    )
      return;
    try {
      await authClient.admin.removeUser({ userId });
      setUsers(users.filter((u) => u.id !== userId));
      toast.success("User deleted successfully.");
    } catch (error) {
      console.error("Failed to delete user:", error);
      toast.error("Failed to delete user.");
    }
  };

  // Summaries
  const totalUsers = users.length;
  const activeStaff = users.filter(
    (u) => u.role !== "customer" && !u.banned,
  ).length;
  const adminCount = users.filter(
    (u) => u.role?.toUpperCase() === "ADMIN",
  ).length;
  const bannedCount = users.filter((u) => u.banned).length;

  return (
    <div>
      {/* ================= HEADER ================= */}
      <header className="border-b sticky w-full top-0 z-10 bg-card/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 px-4 py-2">
        <div className="flex items-center gap-3">
          <SidebarTrigger className="-ml-1" />
          <span>
            <h1 className="text-2xl font-bold text-foreground">
              User Management
            </h1>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="bg-white dark:bg-transparent shadow-sm"
          >
            <Download className="mr-2 h-4 w-4" /> Bulk Import
          </Button>
        </div>
      </header>
      <div className="p-8 mx-auto space-y-8">
        {/* ================= SUMMARY CARDS ================= */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Total Users"
            value={totalUsers}
            trend="+12%"
            isPositive={true}
            Icon={UsersIcon}
          />
          <StatCard
            title="Active Staff"
            value={activeStaff}
            trend="+3%"
            isPositive={true}
            Icon={UserCheck}
          />
          <StatCard
            title="Super Admins"
            value={adminCount}
            trend="Stable"
            isPositive={true}
            Icon={Shield}
          />
          <StatCard
            title="Banned Users"
            value={bannedCount}
            trend="-2%"
            isPositive={false}
            Icon={Ban}
          />
        </div>
        {/* ================= CONTROLS (Search & Filters) ================= */}
        <Constrols
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedRole={selectedRole}
          setSelectedRole={setSelectedRole}
        />
        {/* ================= CUSTOM TABLE ================= */}
        <div className="bg-white dark:bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-slate-50 dark:bg-muted/50 border-b border-border">
              <TableRow>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300 w-75">
                  User
                </TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300">
                  Role
                </TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300">
                  Status
                </TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300">
                  Permissions
                </TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300">
                  Send Mail
                </TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300 text-right pr-6">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-32 text-center text-muted-foreground"
                  >
                    <div className="flex flex-col items-center justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mb-2"></div>
                      Loading users...
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-32 text-center text-muted-foreground"
                  >
                    No users found matching your criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((user) => (
                  <TableRow
                    key={user.id}
                    className="hover:bg-slate-50/50 dark:hover:bg-muted/20"
                  >
                    {/* users */}
                    <TableCell className="py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex aspect-square size-10 items-center justify-center rounded-full bg-slate-100 dark:bg-muted text-slate-500 overflow-hidden shadow-sm border border-border">
                          {user.image ? (
                            <img
                              src={user.image}
                              alt={user.name}
                              className="size-full object-cover"
                            />
                          ) : (
                            <UserIcon className="size-5" />
                          )}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">
                            {user.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {user.email}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    {/* ROLE */}
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <RoleBadge role={user.role || "CUSTOMER"} />
                      </div>
                    </TableCell>
                    {/* STATUS */}
                    <TableCell>
                      {user.banned ? (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400">
                          Banned
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400">
                          Active
                        </span>
                      )}
                    </TableCell>
                    {/* PERMISSIONS (Mocked based on role for visual match) */}
                    <TableCell>
                      <div className="flex gap-2 text-xs text-muted-foreground font-medium">
                        {user.role?.toUpperCase() === "ADMIN"
                          ? "Full Access"
                          : user.role?.toUpperCase() === "KITCHEN"
                            ? "View Orders, KDS"
                            : user.role?.toUpperCase() === "STAFF"
                              ? "Create Orders"
                              : "View Menu"}
                      </div>
                    </TableCell>
                    <TableCell>Send Mail</TableCell>
                    {/* ACTIONS */}
                    <TableCell className="text-right pr-6">
                      <div className="flex items-center justify-end gap-2">
                        <Actions
                          handleDeleteUser={handleDeleteUser}
                          handleSetRole={handleSetRole}
                          handleToggleBan={handleToggleBan}
                          user={user}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

export default Users;
