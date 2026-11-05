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
// Installed wallets get their own "Installed" group (EIP-6963); this is the fallback for any other
// extension that only sets window.ethereum, under a name that says what it is.
const plain = (wallet, name) => (opts) => ({ ...wallet(opts), name });
const listed = wallets.map((w) => (w === rkWallets.injectedWallet ? plain(w, "Another browser wallet") : w));
const connectors = connectorsForWallets([{ groupName: "Other wallets", wallets: listed }], {
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
theme.fonts.body = '"IBM Plex Mono", ui-monospace, Consolas, monospace';

// The modal's footnote, in the site's own words.
const Disclaimer = ({ Text }) => h(Text, null, "Hydra only asks your wallet to sign a message. No transaction, no gas.");

// The page's own buttons: Connect opens RainbowKit's wallet list; once connected, Disconnect. No
// RainbowKit account panel (its avatar and token balance mean nothing on this page).
function Button({ onAccount }) {
  return h(ConnectButton.Custom, null, ({ account, openConnectModal, mounted }) => {
    React.useEffect(() => {
      if (mounted) onAccount(account?.address ?? null);
    }, [mounted, account?.address]);
    if (mounted && account) {
      return h("button", { className: "ghost-btn", type: "button", onClick: () => actions.disconnect(config), "data-testid": "disconnect" }, "Disconnect");
    }
    return h("button", { className: "btn", type: "button", onClick: openConnectModal, "data-testid": "connect" }, "Connect wallet");
  });
}

// Mounts the connect button into `el`; onAccount gets the address, or null when disconnected.
export function mount(el, onAccount) {
  const client = new QueryClient();
  createRoot(el).render(
    h(wagmi.WagmiProvider, { config }, h(QueryClientProvider, { client }, h(RainbowKitProvider, { theme, modalSize: "compact", appInfo: { appName: "Hydra", disclaimer: Disclaimer, learnMoreUrl: "https://ethereum.org/en/wallets/find-wallet/" } }, h(Button, { onAccount })))),
  );
}

// personal_sign through whichever wallet is connected.
export const sign = (message) => actions.signMessage(config, { message });
