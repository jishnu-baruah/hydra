# How we use Arkiv

## Do our filters, owners and expiries fit what the app does?

| What the user does | Entity and filter | Owner | Expiry, and why |
|---|---|---|---|
| Looks up an app's release history (explorer) | `hydra.release` where `app` = name, newest by `published_at` | API wallet, with the team's address in `publisher` | Network maximum: a release is a permanent record, not a cache |
| Checks a page (extension): "which app serves this script?" | `hydra.file` where `sha256` = hash, then the file's `release` key | API wallet | Network maximum, same as the release it points to |
| Claims an app name | `hydra.app` where `app` = name, earliest `created_at` wins | API wallet, team in `publisher` | **30-day lease**, extended to the maximum by each publish, so names nobody publishes under free themselves with no cleanup code |
| Sees whether a site was checked recently (indexer page) | `hydra.observation` where `observed_at` is within 3 days | indexer wallet | **3 days**: "checked recently" is simply "an observation exists", and old observations disappear without us deleting anything |

Every filter column is `.indexed()`; the payload that is not filtered on (scripts list, problems)
sits in `body`. Details of each column: [`schema.md`](schema.md).

## Does each Arkiv feature change something users see?

- **Owner wallet and `createdBy`:** the explorer and extension only trust entities created by our
  wallets, so a stranger who writes a fake `hydra.release` for someone's app never shows up. Without
  it the whole check could be spoofed.
- **Entity expiry:** gives us name leases (a team that stops publishing loses the name, a rival
  can then claim it) and a self-cleaning 3-day observation log, which keeps the indexer page current
  with 247 sites instead of growing forever.
- **Extending expiry (`extendEntity`, in the same batch as the file records):** a publish renews the
  app's lease at no extra transaction, so a team that keeps shipping keeps its name.
- **Batched writes (`executeBatch`):** one transaction per 10 observations or per release's files
  (up to 20 operations), so the first 247-site run wrote 236 observations in 24 transactions instead of 236.
- **SQL-like filters and ordering:** the extension asks the Hydra API, which resolves each script
  hash to an app with one filtered query on `hydra.file` (up to 5 hashes per page), the explorer
  lists the newest releases with an ordered query, and the indexer reads its own previous
  observations to write only what changed.
- **Public reads with no key:** the explorer reads Rabdi directly in the browser, and the API
  behind the extension reads the same records, so what a user sees can be checked by running the
  query in the README.

Entity ownership transfer, encryption and Arkiv event subscriptions are not used.
