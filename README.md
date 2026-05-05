# Eggs backend

The Eggs mini app is shut down. This backend now only supports the shutdown
surface:

- read-only `$EGGS` wallet/staked balance lookup for unstake UI support;
- chicken NFT metadata at `/chicken-metadata/:serialId.json`;
- legacy-token-authenticated chicken mint signatures for existing chickens.

Removed responsibilities include Privy login, egg claiming, emission accrual,
jackpot tickets/accounting/draws, Farcaster webhooks, referrals, background
economy jobs, proxy management, and chicken level upgrades.

## Environment variables

| Name                            | Description                                          |
| ------------------------------- | ---------------------------------------------------- |
| `POSTGRES`                      | URL of the psql database                             |
| `PORT`                          | Port to run server on (defaults to 1337)             |
| `JWT_SECRET`                    | Secret for validating existing legacy auth tokens    |
| `EGGS_CONTRACT_ADDRESS`         | `$EGGS` contract address used for read-only balances |
| `BASE_RPC_URL`                  | Base RPC URL for read-only contract calls            |
| `CHICKENS_SUPER_HEN_PRIVATE_KEY` | Signer key for chicken NFT mint signatures           |

Also, please, consider looking at `.env.sample`.
