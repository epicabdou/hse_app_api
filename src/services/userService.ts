// 3. User Service (userService.js)
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export class UserService {
    static async createUser(userData) {
        try {
            const newUser = {
                clerkUserId: userData.id,
                email: userData.email_addresses?.[0]?.email_address || null,
                firstName: userData.first_name || null,
                lastName: userData.last_name || null,
                imageUrl: userData.image_url || userData.profile_image_url || null,
                inspectionCount: 0,
                monthlyInspectionCount: 0,
                lastResetDate: new Date(),
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const [createdUser] = await db.insert(users).values(newUser).returning();
            console.log('User created successfully:', createdUser.clerkUserId);
            return createdUser;
        } catch (error) {
            console.error('Error creating user:', error);
            throw error;
        }
    }

    static async updateUser(clerkUserId, updateData) {
        try {
            const updatedFields = {
                email: updateData.email_addresses?.[0]?.email_address || null,
                firstName: updateData.first_name || null,
                lastName: updateData.last_name || null,
                imageUrl: updateData.image_url || updateData.profile_image_url || null,
                updatedAt: new Date()
            };

            // Remove null/undefined values
            const filteredFields = Object.fromEntries(
                Object.entries(updatedFields).filter(([_, value]) => value !== null && value !== undefined)
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