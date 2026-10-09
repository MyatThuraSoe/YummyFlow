import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
import { ac, ADMIN, CUSTOMER, KITCHEN, MANAGER, STAFF } from "./permissions";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BACKEND_URL,
  plugins: [
    adminClient({
      ac: ac,
      roles: {
        ADMIN,
        MANAGER,
        STAFF,
        KITCHEN,
        CUSTOMER,
      },
    }),
  ],
});
