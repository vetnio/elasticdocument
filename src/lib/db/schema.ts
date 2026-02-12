import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";

// ─── BetterAuth Tables ───────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),

  // Admin plugin fields
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("banReason"),
  banExpires: timestamp("banExpires"),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonatedBy"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
});

// ─── App Tables ──────────────────────────────────────────────

export const document = pgTable(
  "document",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fileName: text("fileName").notNull(),
    fileType: text("fileType").notNull(),
    fileSize: integer("fileSize").notNull(),
    blobUrl: text("blobUrl").notNull(),
    isUrl: boolean("isUrl").notNull().default(false),
    sourceUrl: text("sourceUrl"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("document_userId_idx").on(t.userId)]
);

export const processedResult = pgTable(
  "processed_result",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    readingMinutes: integer("readingMinutes").notNull(),
    complexityLevel: text("complexityLevel").notNull(),
    outputLanguage: text("outputLanguage").notNull(),
    markdownContent: text("markdownContent").notNull(),
    extractedImages: text("extractedImages").array().notNull().default([]),
    outputContent: text("outputContent").notNull(),
    outputImages: text("outputImages").array().notNull().default([]),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("processed_result_userId_idx").on(t.userId)]
);

export const usageLog = pgTable(
  "usage_log",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("usage_log_userId_createdAt_idx").on(t.userId, t.createdAt)]
);

// ─── Prisma implicit join table (existing) ───────────────────

export const documentToProcessedResult = pgTable(
  "_DocumentToProcessedResult",
  {
    A: text("A")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    B: text("B")
      .notNull()
      .references(() => processedResult.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.A, t.B] }),
    index("_DocumentToProcessedResult_B_index").on(t.B),
  ]
);

// ─── Relations ───────────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  documents: many(document),
  processedResults: many(processedResult),
  usageLogs: many(usageLog),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const documentRelations = relations(document, ({ one, many }) => ({
  user: one(user, { fields: [document.userId], references: [user.id] }),
  documentToProcessedResults: many(documentToProcessedResult),
}));

export const processedResultRelations = relations(
  processedResult,
  ({ one, many }) => ({
    user: one(user, {
      fields: [processedResult.userId],
      references: [user.id],
    }),
    documentToProcessedResults: many(documentToProcessedResult),
  })
);

export const usageLogRelations = relations(usageLog, ({ one }) => ({
  user: one(user, { fields: [usageLog.userId], references: [user.id] }),
}));

export const documentToProcessedResultRelations = relations(
  documentToProcessedResult,
  ({ one }) => ({
    document: one(document, {
      fields: [documentToProcessedResult.A],
      references: [document.id],
    }),
    processedResult: one(processedResult, {
      fields: [documentToProcessedResult.B],
      references: [processedResult.id],
    }),
  })
);
