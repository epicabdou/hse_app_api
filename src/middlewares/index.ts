import { clerkClient } from '@clerk/express'

export async function requireSuperadmin(req, res, next) {
    try {
        const user = await clerkClient.users.getUser(req.userId)

        const role = user?.publicMetadata?.appRole

        if (role === "superadmin") return next();
        return res.status(403).json({ error: "Forbidden: superadmin only" });
    } catch (error) {
        console.error('Error fetching user:', error);
        return res.status(500).json({ error: "Internal server error" });
    }
}