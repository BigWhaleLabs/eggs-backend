import { type User } from '@prisma/client'
import env from 'helpers/env'
import jwt from 'jsonwebtoken'

export function getAuthToken(user: User) {
  return jwt.sign({ userId: user.id }, env.JWT_SECRET)
}

export function verifyAuthToken(jwtString: string) {
  return jwt.verify(jwtString, env.JWT_SECRET)
}
