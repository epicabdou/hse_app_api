// src/db/schema.ts
import { pgTable, uuid, varchar, integer, timestamp, jsonb, decimal, boolean, text } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

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
    isBlocked: boolean('is_blocked').default(false),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow()
});

// Inspections table
export const inspections = pgTable('inspections', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    imageUrl: text('image_url').notNull(),
    originalImageUrl: text('original_image_url'), // Store original if we compress
    hazardCount: integer('hazard_count').default(0),
    riskScore: integer('risk_score'), // 0-100
    safetyGrade: varchar('safety_grade', { length: 2 }), // A-F
    analysisResults: jsonb('analysis_results'), // Full AI response
    processingStatus: varchar('processing_status', { length: 20 }).default('pending'), // pending, processing, completed, failed
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow()
});

// Usage logs for cost tracking and analytics
export const usageLogs = pgTable('usage_logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    endpoint: varchar('endpoint', { length: 100 }).notNull(),
    tokensUsed: integer('tokens_used'),
    apiCost: decimal('api_cost', { precision: 10, scale: 6 }), // Store in USD
    responseTime: integer('response_time'), // milliseconds
    success: boolean('success').default(true),
    errorType: varchar('error_type', { length: 50 }),
    createdAt: timestamp('created_at').defaultNow()
});

// Admin settings (for feature flags, limits, etc.)
export const settings = pgTable('settings', {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 100 }).unique().notNull(),
    value: text('value').notNull(),
    description: text('description'),
    updatedAt: timestamp('updated_at').defaultNow()
});

// Zod schemas for validation
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);

export const insertInspectionSchema = createInsertSchema(inspections);
export const selectInspectionSchema = createSelectSchema(inspections);

export const insertUsageLogSchema = createInsertSchema(usageLogs);
export const selectUsageLogSchema = createSelectSchema(usageLogs);

// Custom validation schemas
export const createInspectionSchema = z.object({
    imageData: z.string().min(1, 'Image data is required'),
    imageType: z.string().optional().default('image/jpeg')
});

export const analysisResultSchema = z.object({
    hazards: z.array(z.object({
        id: z.string(),
        description: z.string(),
        location: z.string(),
        category: z.enum(['PPE', 'Fall', 'Fire', 'Electrical', 'Chemical', 'Machinery', 'Environmental', 'Other']),
        severity: z.enum(['Critical', 'High', 'Medium', 'Low']),
        immediateSolutions: z.array(z.string()),
        longTermSolutions: z.array(z.string()),
        estimatedCost: z.string().optional(),
        timeToImplement: z.string().optional(),
        priority: z.number().min(1).max(10)
    })),
    overallAssessment: z.object({
        riskScore: z.number().min(0).max(100),
        safetyGrade: z.enum(['A', 'B', 'C', 'D', 'F']),
        topPriorities: z.array(z.string()).max(3),
        complianceStandards: z.array(z.string()).optional()
    }),
    metadata: z.object({
        analysisTime: z.number(),
        tokensUsed: z.number(),
        confidence: z.number().min(0).max(100)
    })
});

// Types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Inspection = typeof inspections.$inferSelect;
export type NewInspection = typeof inspections.$inferInsert;
export type UsageLog = typeof usageLogs.$inferSelect;
export type NewUsageLog = typeof usageLogs.$inferInsert;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;