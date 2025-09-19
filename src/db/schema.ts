// src/db/schema.ts
import {
    pgTable,
    uuid,
    varchar,
    integer,
    timestamp,
    jsonb,
    decimal,
    boolean,
    text,
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

/* =========================
   Tables
   ========================= */

// Users table - synced from Clerk webhook
export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    clerkUserId: varchar('clerk_user_id', { length: 255 }).unique().notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    imageUrl: text('image_url'),
    inspectionCount: integer('inspection_count').default(0),
    monthlyInspectionCount: integer('monthly_inspection_count').default(0),
    lastResetDate: timestamp('last_reset_date').defaultNow(),
    // fixed column name to match property
    isActive: boolean('is_active').default(false),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// Inspections table
export const inspections = pgTable('inspections', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
        .references(() => users.id)
        .notNull(),
    imageUrl: text('image_url').notNull(),
    originalImageUrl: text('original_image_url'),
    hazardCount: integer('hazard_count').default(0),
    riskScore: integer('risk_score'),
    safetyGrade: varchar('safety_grade', { length: 2 }),
    analysisResults: jsonb('analysis_results'),
    processingStatus: varchar('processing_status', { length: 20 }).default('pending'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// Usage logs for cost tracking and analytics
export const usageLogs = pgTable('usage_logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    endpoint: varchar('endpoint', { length: 100 }).notNull(),
    tokensUsed: integer('tokens_used'),
    apiCost: decimal('api_cost', { precision: 10, scale: 6 }), // stored as DECIMAL in PG
    responseTime: integer('response_time'),
    success: boolean('success').default(true),
    errorType: varchar('error_type', { length: 50 }),
    createdAt: timestamp('created_at').defaultNow(),
});

// Admin settings (for feature flags, limits, etc.)
export const settings = pgTable('settings', {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 100 }).unique().notNull(),
    value: text('value').notNull(),
    description: text('description'),
    updatedAt: timestamp('updated_at').defaultNow(),
});

/* =========================
   drizzle-zod Schemas
   (per the documentation)
   ========================= */

/**
 * drizzle-zod maps columns automatically.
 * You can override fields to coerce/validate (dates, enums, decimals, etc.).
 * Insert schemas: make DB-generated fields optional.
 */

// Users
export const insertUserSchema = createInsertSchema(users, {
    id: (s) => s.uuid().optional(),
    clerkUserId: (s) => s.min(1),
    email: (s) => s.email(),
    firstName: (s) => s.max(100).optional(),
    lastName: (s) => s.max(100).optional(),
    inspectionCount: (s) => s.int().nonnegative().optional(),
    monthlyInspectionCount: (s) => s.int().nonnegative().optional(),
    lastResetDate: () => z.coerce.date().optional(),
    isActive: () => z.coerce.boolean().optional(),
    createdAt: () => z.coerce.date().optional(),
    updatedAt: () => z.coerce.date().optional(),
});

export const selectUserSchema = createSelectSchema(users, {
    id: (s) => s.uuid(),
    email: (s) => s.email(),
    lastResetDate: () => z.coerce.date(),
    createdAt: () => z.coerce.date(),
    updatedAt: () => z.coerce.date(),
});

// Inspections
const SafetyGradeEnum = z.enum(['A', 'B', 'C', 'D', 'F']);
const ProcessingStatusEnum = z.enum(['pending', 'processing', 'completed', 'failed']);

export const insertInspectionSchema = createInsertSchema(inspections, {
    id: (s) => s.uuid().optional(),
    userId: (s) => s.uuid(),
    imageUrl: (s) => s.min(1),
    originalImageUrl: (s) => s.min(1).optional(),
    hazardCount: (s) => s.int().min(0).optional(),
    riskScore: (s) => s.int().min(0).max(100).optional(),
    safetyGrade: () => SafetyGradeEnum.optional(),
    analysisResults: () => z.any().optional(),
    processingStatus: () => ProcessingStatusEnum.optional(),
    errorMessage: (s) => s.min(1).optional(),
    createdAt: () => z.coerce.date().optional(),
    updatedAt: () => z.coerce.date().optional(),
});

export const selectInspectionSchema = createSelectSchema(inspections, {
    safetyGrade: () => SafetyGradeEnum.nullish(),
    processingStatus: () => ProcessingStatusEnum,
    createdAt: () => z.coerce.date(),
    updatedAt: () => z.coerce.date(),
});

// UsageLogs
export const insertUsageLogSchema = createInsertSchema(usageLogs, {
    id: (s) => s.uuid().optional(),
    userId: (s) => s.uuid().optional(),
    endpoint: (s) => s.min(1),
    tokensUsed: (s) => s.int().min(0).optional(),
    // DECIMAL comes back as string; coerce for inserts if you accept numbers from clients
    apiCost: () => z.union([z.string(), z.coerce.number()]).optional(),
    responseTime: (s) => s.int().min(0).optional(),
    success: () => z.coerce.boolean().optional(),
    errorType: (s) => s.min(1).optional(),
    createdAt: () => z.coerce.date().optional(),
});

export const selectUsageLogSchema = createSelectSchema(usageLogs, {
    // keep as string for exact money representation (PG DECIMAL)
    apiCost: () => z.string().optional(),
    createdAt: () => z.coerce.date(),
});

// Settings
export const insertSettingsSchema = createInsertSchema(settings, {
    id: (s) => s.uuid().optional(),
    key: (s) => s.min(1),
    value: (s) => s.min(1),
    description: (s) => s.min(1).optional(),
    updatedAt: () => z.coerce.date().optional(),
});

export const selectSettingsSchema = createSelectSchema(settings, {
    updatedAt: () => z.coerce.date(),
});

/* =========================
   Custom app-level schemas
   ========================= */

export const createInspectionSchema = z.object({
    imageData: z.string().min(1, 'Image data is required'),
    imageType: z.string().optional().default('image/jpeg'),
});

export const analysisResultSchema = z.object({
    hazards: z.array(
        z.object({
            id: z.string(),
            description: z.string(),
            location: z.string(),
            category: z.enum([
                'PPE',
                'Fall',
                'Fire',
                'Electrical',
                'Chemical',
                'Machinery',
                'Environmental',
                'Other',
            ]),
            severity: z.enum(['Critical', 'High', 'Medium', 'Low']),
            immediateSolutions: z.array(z.string()),
            longTermSolutions: z.array(z.string()),
            estimatedCost: z.string().optional(),
            timeToImplement: z.string().optional(),
            priority: z.number().min(1).max(10),
        }),
    ),
    overallAssessment: z.object({
        riskScore: z.number().min(0).max(100),
        safetyGrade: SafetyGradeEnum,
        topPriorities: z.array(z.string()).max(3),
        complianceStandards: z.array(z.string()).optional(),
    }),
    metadata: z.object({
        analysisTime: z.number(),
        tokensUsed: z.number(),
        confidence: z.number().min(0).max(100),
    }),
});

/* =========================
   Types
   ========================= */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Inspection = typeof inspections.$inferSelect;
export type NewInspection = typeof inspections.$inferInsert;
export type UsageLog = typeof usageLogs.$inferSelect;
export type NewUsageLog = typeof usageLogs.$inferInsert;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;