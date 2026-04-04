import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload } from '../lib/jwt';

type Role = JwtPayload['role'];

export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  };
}
