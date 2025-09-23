import { getAuth, clerkClient } from "@clerk/express";

/**
 * Factory: ensure the signed-in user has one of the allowed roles.
 * Reads role from Clerk publicMetadata.appRole (e.g. "superadmin").
 */
export const requireRole = (...allowedRoles) => {
    return async (req, res, next) => {
        try {
            const { userId } = getAuth(req);
            if (!userId) return res.status(401).json({ error: "Unauthorized" });

            const user = await clerkClient.users.getUser(userId);
            const role = user?.publicMetadata?.appRole;

            if (!allowedRoles.includes(role)) {
                return res
                    .status(403)
                    .json({ error: `Forbidden: ${allowedRoles.join(" or ")} access required` });
            }

            // make the user/role available to downstream handlers if needed
            req.user = user;
            req.appRole = role;
            next();
        } catch (err) {
            console.error("Role check failed:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    };
};
