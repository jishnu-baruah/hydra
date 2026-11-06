# Friction: what got in our way with Arkiv

Builder feedback from building Hydra on Rabdi with `@arkiv-network/sdk` 1.0.1. Each item says what
we expected, what happened, how to reproduce it, and whether we re-checked it on Rabdi. Items from
the pre-event spikes ran on Tiramisu with an older SDK and are marked.

## Things that broke or surprised us

1. **A where() on a u64 column needs the value wrapped as u64.** Expected `gte('observed_at', 5n)`
   to work. Happened: `"observed_at" is a u64 column, but the predicate asserts a u256, so it could
   never match. Write u64(...) around the value.` The message is good, but the SDK knows the
   column type and could coerce. Reproduce: filter an `observed_at` u64 column with a bare bigint.
   Seen on Rabdi, SDK 1.0.1, 6 Nov.
2. **Queries return at most 100 rows per page, and skipped rows count toward the offset.** Expected a
   cursor or a larger page for a read of a few hundred rows. We wrote a helper that pages with
   `offset(n)` until a page covers fewer than 100. Documented in the SDK types but easy to miss;
   a `fetchAll()` would save every app the same helper. Seen on Rabdi, 6 Nov.
3. **The SDK 1.0.1 ESM build did not load on Node 22.17** (`ERR_REQUIRE_CYCLE_MODULE` on a 0-byte
   dist chunk). It loaded on Node 24 and in the browser from jsdelivr. Reproduce: `import
   '@arkiv-network/sdk'` on Node 22.17. Our scripts say "Node 24".
4. **Two copies of the SDK in one browser page break every query.** Mixing CDNs (jsdelivr and
   another) gave two SDK instances and all queries failed. We load everything from one CDN.
5. **Anyone can write an entity with our schema name.** Expected some way to own a schema or
   namespace. Happened: a stranger can create a `hydra.release` entity. We filter every read by
   `createdBy(our wallet)`. A schema-level "only this owner may create" would remove a whole class
   of spoofing. Seen on Rabdi.
6. **`$createdAt` is a block number, not a time.** Showing dates needs `getBlockTiming()` and math
   with the block duration. A `$createdAtTime` would help any UI.
7. **An extension that moves the expiry earlier is rejected.** Expected `extendEntity` to take
   "a new expiry" and leave a longer one alone. Happened: an error. We extend to the maximum in the
   same batch as the files, so the case does not arise, but a no-op would be gentler.
8. **Errors are wrapped about six levels deep in viem output, and the keyed RPC URL appears in
   them.** We print the innermost cause and redact every URL, because the access key is in the URL.
   An SDK option to strip the key from error text would be welcome.
9. **A write needs an explicit nonce at `latest`, an explicit gasPrice and gas of at least about
   1,000,000.** Expected the SDK's estimate to be enough. We wrap writes in one guarded path that
   never resends, because a resend after an unknown failure could double-write.
10. **No subscription by filter.** We poll the indexer's own observations every run. A "tell me
    when an entity matching this filter appears" would have let the extension and alerts react
    without polling. Event logs only reach about 1,000 blocks back.

## From the pre-event spikes (Tiramisu, SDK 0.8.1, not re-checked on Rabdi)

- Uppercase attribute names reverted on chain (`Ident32InvalidByte`), although the SDK's own error
  text said A to Z is allowed. We use lowercase snake_case everywhere.
- A bare JS number was encoded as i32, so `Date.now()` threw. We pass `u64(BigInt(ms))`.
- A create took 3 to 7 seconds, so we batch.

## What would make building easier

A fetch-all helper (2), schema-level write ownership (5), a time field next to the block number
(6), filter subscriptions (10), and an option to keep the access key out of error text (8).
