import {
  Ban,
  CheckCircle,
  MoreHorizontal,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { AVAILABLE_ROLES } from "./contants";
import type { roles, User } from "@/type";

const Actions = ({
  handleDeleteUser,
  handleSetRole,
  handleToggleBan,
  user,
}: {
  handleSetRole: (userId: string, newRole: roles) => void;
  handleToggleBan: (userId: string, currentlyBanned: boolean) => void;
  handleDeleteUser: (userId: string) => void;
  user: User;
}) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="shadow-none">
          <MoreHorizontal className="h-4 w-4 text-slate-500" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Manage User</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Role Change Sub-Menu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ShieldAlert className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Change Role</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              {AVAILABLE_ROLES.map((role) => (
                <DropdownMenuItem
                  key={role}
                  onClick={() => handleSetRole(user.id, role)}
                  disabled={user.role?.toUpperCase() === role}
                  className="uppercase text-xs font-semibold"
                >
                  {role}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        {/* Ban Toggle */}
        <DropdownMenuItem
          onClick={() => handleToggleBan(user.id, user.banned || false)}
        >
          {user.banned ? (
            <>
              <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
              <span>Unban User</span>
            </>
          ) : (
            <>
              <Ban className="mr-2 h-4 w-4 text-orange-500" />
              <span>Ban User</span>
            </>
          )}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Delete */}
        <DropdownMenuItem
          onClick={() => handleDeleteUser(user.id)}
          className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-500/10"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          <span>Delete User</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default Actions;
