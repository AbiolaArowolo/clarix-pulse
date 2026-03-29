import { AuthenticatedSession } from '../store/auth';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedSession;
    }
  }
}

export {};
