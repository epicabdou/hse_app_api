// 3. User Service (userService.js)
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

function extractEmail(userData: any): string | null {
    // 1) Try primary_email_address_id
    const primaryId = userData.primary_email_address_id || userData.primary_email?.id;
    if (primaryId && Array.isArray(userData.email_addresses)) {
        const primary = userData.email_addresses.find((e: any) => e.id === primaryId);
        if (primary?.email_address) return primary.email_address;
    }
    // 2) Try first verified email if available
    if (Array.isArray(userData.email_addresses)) {
        const verified = userData.email_addresses.find((e: any) => e.verification?.status === 'verified');
        if (verified?.email_address) return verified.email_address;
    }
    // 3) Fall back to the first item if present
    const first = userData.email_addresses?.[0]?.email_address;
    if (first) return first;

    // 4) Legacy fields sometimes exist
    if (userData.emailAddress) return userData.emailAddress;
    if (userData.email_address) return userData.email_address;

    return null;
}

function extractImageUrl(userData: any): string | null {
    return userData.image_url || userData.profile_image_url || null;
}

export class UserService {
    static async createUser(userData: any) {
        try {
            const email = extractEmail(userData);

            // If your DB requires NOT NULL on email, guard before insert
            if (!email) {
                console.warn(
                    `createUser: Clerk user ${userData.id} has no resolvable email yet; skipping insert until update delivers email.`
                );
                // You can choose to return null or the Clerk payload, but do NOT insert.
                return null;
            }

            const newUser = {
                clerkUserId: userData.id,
                email,
                firstName: userData.first_name || null,
                lastName: userData.last_name || null,
                imageUrl: extractImageUrl(userData),
                inspectionCount: 0,
                monthlyInspectionCount: 0,
                lastResetDate: new Date(),  // or let DB default if defined in schema
                isActive: true,
                createdAt: new Date(),      // or let DB default
                updatedAt: new Date(),      // or let DB default
            };

            const [createdUser] = await db.insert(users).values(newUser).returning();
            console.log('User created successfully:', createdUser.clerkUserId);
            return createdUser;
        } catch (error) {
            console.error('Error creating user:', error);
            throw error;
        }
    }

    static async updateUser(clerkUserId: string, updateData: any) {
        try {
            const maybeEmail = extractEmail(updateData);

            const updatedFields: Record<string, any> = {
                // Only include email if we actually have one (prevents NOT NULL violation on update)
                ...(maybeEmail ? { email: maybeEmail } : {}),
                firstName: updateData.first_name ?? null,
                lastName: updateData.last_name ?? null,
                imageUrl: extractImageUrl(updateData),
                updatedAt: new Date(),
            };

            // Remove null/undefined values (avoid overwriting with nulls unless intended)
            const filteredFields = Object.fromEntries(
                Object.entries(updatedFields).filter(([, value]) => value !== null && value !== undefined)
            );

            const [updatedUser] = await db
                .update(users)
                .set(filteredFields)
                .where(eq(users.clerkUserId, clerkUserId))
                .returning();

            if (!updatedUser) {
                console.log('User not found for update, creating new user');
                return await this.createUser(updateData);
            }

            console.log('User updated successfully:', updatedUser.clerkUserId);
            return updatedUser;
        } catch (error) {
            console.error('Error updating user:', error);
            throw error;
        }
    }

    static async deleteUser(clerkUserId) {
        try {
            // Soft delete - mark as inactive instead of hard delete
            const [deletedUser] = await db
                .update(users)
                .set({
                    isActive: false,
                    updatedAt: new Date()
                })
                .where(eq(users.clerkUserId, clerkUserId))
                .returning();

            console.log('User soft deleted:', deletedUser?.clerkUserId);
            return deletedUser;
        } catch (error) {
            console.error('Error deleting user:', error);
            throw error;
        }
    }

    static async getUserByClerkId(clerkUserId) {
        try {
            const [user] = await db
                .select()
                .from(users)
                .where(eq(users.clerkUserId, clerkUserId))
                .limit(1);

            return user || null;
        } catch (error) {
            console.error('Error fetching user:', error);
            throw error;
        }
    }
}