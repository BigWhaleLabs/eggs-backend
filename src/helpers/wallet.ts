import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import env from './env'

export const publicClient = createPublicClient({
  chain: base,
  transport: http(env.BASE_RPC_URL),
})
