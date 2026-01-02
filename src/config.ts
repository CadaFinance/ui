import { createConfig, http, cookieStorage, createStorage } from 'wagmi'
import { getDefaultConfig } from 'connectkit'

// Read from environment variables
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID)
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc1.zugchain.org"
const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || "https://explorer1.zugchain.org"
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "3a8170812b534d0ff9d794f19a901d64"

const zugChain = {
  id: CHAIN_ID,
  name: 'ZugChain',
  nativeCurrency: { name: 'Zug', symbol: 'ZUG', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'ZugExplorer', url: EXPLORER_URL },
  },
} as const

export const config = createConfig(
  getDefaultConfig({
    // Your dApps chains
    chains: [zugChain],
    transports: {
      [zugChain.id]: http(RPC_URL),
    },

    // Required API Keys
    walletConnectProjectId: WALLETCONNECT_PROJECT_ID,

    // Required App Info
    appName: "ZugStaking",
    appDescription: "Native Staking for ZugChain",
    appUrl: "https://zugchain.org",
    appIcon: "https://family.co/logo.png",

    // SSR Configuration
    ssr: true,
    storage: createStorage({
      storage: cookieStorage,
    }),
  }),
)

