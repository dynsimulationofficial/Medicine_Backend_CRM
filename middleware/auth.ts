// middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, msg: "Unauthorized", data: {} });
    }
    const token = header.slice(7);

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET || "your_secret_key") as any;
        (req as any).user = { system_user_id: payload.system_user_id, email: payload.email };
        next();
    } catch {
        return res.status(401).json({ success: false, msg: "Unauthorized", data: {} });
    }
}
