// Alerts from an indexer run, sent to Telegram. Only news alerts: a site turning mismatch, a new
// loud problem, or a recovery. Everything that varies run to run (TRUNCATED, UNREACHABLE, a
// first sighting) stays quiet, or 247 sites would page someone every 30 minutes.
// Messages are plain text (no parse_mode), so URLs and strings from sites cannot inject markup.

const LOUD = new Set(['EXTRA', 'CHANGED', 'UNREADABLE', 'RUNTIME_ORIGIN', 'NEW_RUNTIME_ORIGIN', 'DOMAIN_PROOF_LOST'])
const PAGE = 'https://hydra-site-one.vercel.app/indexed/'
const code = (p: string) => p.split(/\s/, 1)[0]

interface Site {
  domain: string
  app?: string
  status: string
  problems: string[]
}

// The message for this site's change since `prev`, or null when it is not news. On an unbound
// site (status unknown) only loud codes count, and CHANGED there is ordinary deploy churn.
export function alertText(now: Site, prev: { status: string; problems: string[] } | null, at: number): string | null {
  const name = `${now.domain}${now.app ? ` (app ${now.app})` : ''}`
  const when = new Date(at).toISOString().slice(0, 16).replace('T', ' ')
  if (prev?.status === 'mismatch' && now.status === 'match') {
    return `Hydra: ${name} recovered: MATCH again, every script is in the release.\nChecked ${when} UTC\n${PAGE}`
  }
  if (!prev) return null
  const before = new Set(prev.problems.map(code))
  const fresh = now.problems.filter((p) => LOUD.has(code(p)) && !before.has(code(p)) && (now.status !== 'unknown' || code(p) !== 'CHANGED'))
  const turned = now.status === 'mismatch' && prev.status !== 'mismatch'
  if (!turned && !fresh.length) return null
  const shown = (turned ? now.problems.filter((p) => LOUD.has(code(p))) : fresh).map((p) => p.slice(0, 200))
  const lines = shown.slice(0, 5).map((p) => `- ${p}`)
  if (shown.length > 5) lines.push(`- and ${shown.length - 5} more`)
  const head = turned ? `Hydra alert: ${name} is now MISMATCH (was ${prev.status}).` : `Hydra alert: ${name} has new problems.`
  return `${head}\n${lines.join('\n')}\nChecked ${when} UTC\n${PAGE}`
}

// One sendMessage, at most 3 attempts: 429 waits Telegram's retry_after (capped at 10 s), 5xx and
// network errors back off. Errors never contain the URL, because the token is in it.
export async function sendTelegram(
  o: { token: string; chatId: string; text: string; delayMs?: number },
  f: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let error = 'not sent'
  for (let attempt = 1; attempt <= 3; attempt++) {
    let wait = (o.delayMs ?? 1000) * attempt
    try {
      const res = await f(`https://api.telegram.org/bot${o.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: o.chatId, text: o.text.slice(0, 4000), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15_000),
      })
      const j = (await res.json().catch(() => ({}))) as { description?: string; parameters?: { retry_after?: number } }
      if (res.ok) return { ok: true }
      error = `Telegram HTTP ${res.status}: ${j.description ?? 'no description'}`
      if (res.status === 429) wait = Math.min(10, j.parameters?.retry_after ?? 1) * 1000 + (o.delayMs ?? 0)
      else if (res.status < 500) break
    } catch (err) {
      error = `Telegram unreachable: ${err instanceof Error ? err.name : 'error'}`
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, o.delayMs !== undefined ? o.delayMs : wait))
  }
  return { ok: false, error: `${error}. Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, and that the bot is in the chat` }
}
