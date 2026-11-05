// Wallet connection for the publish page, with RainbowKit: its modal, restyled to the explorer's
// theme, and a connect button drawn in the page's own style. React, wagmi and RainbowKit load from
// esm.sh at pinned versions through the import map in publish/index.html, which gives every package
// the same copy of React, react-query and wagmi (2 copies break their shared state). The explorer
// has no build. Changing the import map changes its hash, which vercel.json's CSP must list.
//
// The wallet only connects and signs the sign-in message. Nothing here sends a transaction.
import React from "react";
import { createRoot } from "react-dom/client";
import * as wagmi from "wagmi";
import * as actions from "wagmi/actions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, ConnectButton, darkTheme, connectorsForWallets } from "@rainbow-me/rainbowkit";
import * as rkWallets from "@rainbow-me/rainbowkit/wallets";

// Phone wallets connect by QR through WalletConnect, which needs a project id from cloud.reown.com.
// Empty: the wallets installed in this browser only (found through EIP-6963).
export const WALLETCONNECT_PROJECT_ID = "";

const RABDI = {
  id: 7794095,
  name: "Arkiv Rabdi",
  nativeCurrency: { name: "tGLM", symbol: "tGLM", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.rabdi.db-chain.testnet.arkiv.network"] } },
  testnet: true,
};

const h = React.createElement;

const wallets = WALLETCONNECT_PROJECT_ID
  ? [rkWallets.injectedWallet, rkWallets.metaMaskWallet, rkWallets.rainbowWallet, rkWallets.walletConnectWallet]
  : [rkWallets.injectedWallet];
const connectors = connectorsForWallets([{ groupName: "Wallets", wallets }], {
  appName: "Hydra",
  projectId: WALLETCONNECT_PROJECT_ID || "hydra-installed-wallets-only",
});
export const config = wagmi.createConfig({
  chains: [RABDI],
  connectors,
  transports: { [RABDI.id]: wagmi.http() },
  ssr: false,
});

const theme = darkTheme({ accentColor: "#7aa2ff", accentColorForeground: "#0a0a0a", borderRadius: "none", fontStack: "system", overlayBlur: "small" });
theme.colors.modalBackground = "#141414";
theme.colors.modalBorder = "#2a2a2a";
theme.fonts.body = '"IBM Plex Sans", system-ui, sans-serif';

// The button is the page's own .btn; RainbowKit supplies the modal and the account state.
function Button({ onAccount }) {
  return h(ConnectButton.Custom, null, ({ account, openConnectModal, openAccountModal, mounted }) => {
    React.useEffect(() => {
      if (mounted) onAccount(account?.address ?? null);
    }, [mounted, account?.address]);
    const connected = mounted && account;
    return h(
      "button",
      { className: "btn", type: "button", onClick: connected ? openAccountModal : openConnectModal, "data-testid": "connect" },
      connected ? `Connected ${account.displayName}` : "Connect wallet",
    );
  });
}

// Mounts the connect button into `el`; onAccount gets the address, or null when disconnected.
export function mount(el, onAccount) {
  const client = new QueryClient();
  createRoot(el).render(
    h(wagmi.WagmiProvider, { config }, h(QueryClientProvider, { client }, h(RainbowKitProvider, { theme, modalSize: "compact", appInfo: { appName: "Hydra" } }, h(Button, { onAccount })))),
  );
}

// personal_sign through whichever wallet is connected.
export const sign = (message) => actions.signMessage(config, { message });
