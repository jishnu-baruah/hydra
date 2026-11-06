// Clean Vault: the page's only script. It works out a demo yield and never touches a wallet.
// Any change to this file changes its sha256, and Hydra then shows the site as changed.
const APY = 0.042;
const LOCK_DAYS = 30;
const $ = (id) => document.getElementById(id);

function quote() {
  const amount = Math.max(0, Number($("amount").value) || 0);
  $("earn").textContent = `${(amount * APY).toFixed(4)} ETH`;
  const unlock = new Date(Date.now() + LOCK_DAYS * 86_400_000);
  $("unlock").textContent = unlock.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

$("apy").textContent = `${(APY * 100).toFixed(2)}%`;
$("amount").addEventListener("input", quote);
$("max").addEventListener("click", () => {
  $("amount").value = "10";
  quote();
});
$("go").addEventListener("click", () => {
  $("note").textContent = "Demo only: nothing was sent and no wallet was asked.";
});
quote();
