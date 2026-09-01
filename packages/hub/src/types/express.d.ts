import { AuthenticatedSession } from '../store/auth';

// LEARN: @clerk/express's `clerkMiddleware()` also augments Express with a
// `req.auth` property (a function returning Clerk's own AuthObject). We keep
// Pulse's resolved, tenant/role-aware session under a different key --
// `req.pulseSession` -- so the two augmentations never collide or shadow
// each other. Everything in this codebase that used to read `req.auth` for
// Pulse's session now reads `req.pulseSession` instead.
declare global {
  namespace Express {
    interface Request {
      pulseSession?: AuthenticatedSession;
    }
  }
}

export {};
