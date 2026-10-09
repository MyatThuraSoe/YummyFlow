import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";
import crypto from "crypto";
import { admin } from "better-auth/plugins";
import { ac, ADMIN, CUSTOMER, KITCHEN, MANAGER, STAFF } from "./permissions";
import { notifyAccountStatus, notifyWelcome } from "./notify";

/**
 * Better Auth's `databaseHooks.user.update.after` receives the fully-updated
 * user but not the patch that produced it, so we cannot tell a ban/unban from
 * an ordinary profile edit. The `before` hook *does* receive the patch, so we
 * set this flag when `banned` is part of the update and consume it in `after`.
 */
let pendingAccountStatusChange = false;

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "mongodb",
  }),
  // so that we ca have a uniform id across all models(prisma schema)
  advanced: {
    database: {
      generateId: () => {
        return crypto.randomBytes(16).toString("hex");
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true, // Automatically sign in users after they sign up
  },
  account: {
    accountLinking: {
      enabled: true,
    },
  },
  baseURL: "http://localhost:5000",
  trustedOrigins: [process.env.CLIENT_URL || "http://localhost:5173"],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  plugins: [
    admin({
      defaultRole: "CUSTOMER",
      ac: ac,
      roles: { ADMIN, MANAGER, STAFF, KITCHEN, CUSTOMER }, // Register all roles with the admin plugin
    }),
  ],
  user: {
    additionalFields: {
      gender: {
        type: "string",
        required: false,
      },
      age: {
        type: "string",
        required: false,
      },
      status: {
        type: "string",
        required: false,
        defaultValue: "active",
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Fire-and-forget: welcome mail must never block or fail a signup.
        after: async (user) => {
          void notifyWelcome({
            id: user.id,
            email: user.email,
            name: (user.name as string) ?? null,
          });
        },
      },
      update: {
        before: async (data) => {
          if (typeof data?.banned === "boolean") {
            pendingAccountStatusChange = true;
          }
        },
        after: async (user) => {
          if (!pendingAccountStatusChange) return;
          pendingAccountStatusChange = false;
          void notifyAccountStatus(user.id);
        },
      },
    },
  },
});
