// middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, msg: "Unauthorized: No token provided", data: {} });
    }
    const token = header.slice(7).trim();

    const secrets = [
        process.env.JWT_SECRET || "your_jwt_secret_key",
        "your_jwt_secret_key",
        "your_secret_key",
    ];

    let verifiedPayload: any = null;
    let lastError: any = null;

    for (const secret of secrets) {
        try {
            verifiedPayload = jwt.verify(token, secret);
            break;
        } catch (err) {
            lastError = err;
        }
    }

    if (verifiedPayload) {
        (req as any).user = {
            system_user_id: verifiedPayload.system_user_id,
            email: verifiedPayload.email,
        };
        return next();
    }

    const isExpired = lastError?.name === "TokenExpiredError";
    return res.status(401).json({
        success: false,
        msg: isExpired ? "Session expired. Please login again." : "Unauthorized",
        data: {},
    });
}
