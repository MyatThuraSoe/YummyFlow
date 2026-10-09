import type { NavItemType } from "./nav-data";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { useLocation } from "react-router";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";

const NavItem = ({ items, title }: { items: NavItemType[]; title: string }) => {
  const { pathname } = useLocation();
  const isActive = (url: string) => pathname === url;
  // console.log(items);
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        {title}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <Collapsible
              key={item.title}
              asChild
              defaultOpen={item.items?.some((sub) => isActive(sub.url))}
              className="group/collapsible"
            >
              <SidebarMenuItem
                className={cn(
                  item.items?.some((sub) => isActive(sub.url)) &&
                    "bg-primary/5 shadow-lg rounded-lg",
                )}
              >
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    tooltip={item.title}
                    className="font-medium py-5 mb-0.5"
                  >
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                    <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 text-muted-foreground" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent className="">
                  <SidebarMenuSub className="border-border mb-4">
                    {item.items?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={isActive(subItem.url)}
                          /* THIS APPLIES THE PRIMARY COLOR WHEN ACTIVE */
                          className={cn(
                            "data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:font-medium data-[active=true]:shadow-sm rounded-md transition-colors py-5 mb-0.5",
                            isActive(subItem.url) &&
                              "shadow-2xl shadow-primary/20",
                          )}
                        >
                          <Link to={subItem.url}>
                            <span>{subItem.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default NavItem;
