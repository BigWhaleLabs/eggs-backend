import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import env from './env'

const superhenAccount = privateKeyToAccount(env.SUPER_HEN_PRIVATE_KEY)

export const publicClient = createPublicClient({
  chain: base,
  transport: http(env.BASE_RPC_URL),
})

export const superHenWallet = createWalletClient({
  account: superhenAccount,
  chain: base,
  transport: http(env.BASE_RPC_URL),
})

export const ownerWallet = createWalletClient({
  account: privateKeyToAccount(env.OWNER_PRIVATE_KEY),
  chain: base,
  transport: http(env.BASE_RPC_URL),
})
