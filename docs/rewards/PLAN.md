# RewardsManager – Plan (PR1)

Scope (minimal first)
- Payout asset: SENDx (the Super Token wrapper for SEND v1) — same wrapper resolution flow as the existing scripts/wrapper/create.ts.
- Distribution primitive: Superfluid Distribution Pool (GDA) — one continuous stream from treasury → pool; pool splits flow by “units”.
- Units = ERC‑4626 share balance (uint128, 1:1 mapping). This mirrors holders’ current on-chain share balances; no custom weighting/precision.
- Contracts in this phase: a single RewardsManager that
  - Creates/owns a Superfluid Pool on SENDx, using official examples (SuperTokenV1Library).
  - Exposes sync(address who) and batchSync(address[] who) to set pool units = share balance of each address.
  - Optionally exposes admin helpers to start/stop one CFA stream via forwarder ONLY if the example is straightforward; otherwise streaming is started externally (e.g., Safe).
- Out of scope now: IDA “true-up”, front-end/AA, and any hybrid model — keep it simple. We can add later.

Networks
- Base mainnet (8453), Base Sepolia (84532), local Base fork (845337).

External dependencies and address sources
- Superfluid core (per-network): Host, CFAv1, (optional) CFAv1Forwarder, SuperTokenFactory.
  - Use official Superfluid network address tables (see references) — do not guess.
- SENDx (SuperToken wrapper of SEND v1):
  - Resolve via deployments/wrapper.{chainId}.json if present.
  - Otherwise read canonical mapping from SuperTokenFactory.getCanonicalERC20Wrapper(SEND v1);
  - If not found and CREATE_WRAPPER=true, create using the same simulate→write pattern as scripts/wrapper/create.ts.
- ERC‑4626 share token address (mirrored for units):
  - Read from send-earn-contracts broadcasts:
    - /Users/vict0xr/Documents/Send/send-earn-contracts/broadcast/DeploySendEarn.s.sol/{chainId}/run-latest.json
  - If absent or ambiguous, allow SHARE_TOKEN_ADDRESS env override and halt docs/tests until provided.

Security & roles (minimal)
- AccessControl.DEFAULT_ADMIN_ROLE to the deployer/admin (config; optional stream helpers if implemented).
- sync and batchSync are open — they can only set units to match on-chain balances; not arbitrary amounts.
- Units use SafeCast to uint128 for pool compatibility.

Contract responsibilities (RewardsManager)
- Constructor:
  - Store references: ISuperToken sendx, IERC20 shareToken, ISuperfluid host, optional address cfaV1Forwarder.
  - Create a Superfluid Pool on SENDx using SuperTokenV1Library (mirror exact example PoolConfig from docs) and set this contract as pool admin.
- sync(address who):
  - balance = shareToken.balanceOf(who)
  - units = uint128(balance)
  - pool.updateMemberUnits(who, units)  // name and usage mirror official examples
- batchSync(address[] who):
  - loop sync for each.
- Optional admin helpers (use only if official forwarder example is clear):
  - startStream(address fromTreasury, int96 flowRate)
  - stopStream(address fromTreasury)
  - If not unambiguous, omit and document that streaming is executed externally by the treasury.

AA and batching (later)
- With ERC‑4337, front-end can batch:
  - deposit → sync(msg.sender)
  - withdraw → sync(msg.sender)
  - transfer → sync(sender) + sync(recipient)
- We will not add front-end or paymaster logic in this phase — only contracts enabling simple batched calls.

Planned PR stack (atomic)
- PR1 (this PR): docs/rewards/PLAN.md (no code changes)
- PR2 (deps/config): add Superfluid Pool/GDA ABIs and extend per-network config (host, CFAv1, forwarder if used). No guesses — only official addresses.
- PR3 (contract): RewardsManager.sol implementing pool creation and sync/batchSync (mirror examples only; STOP if no example).
- PR4 (script): scripts/rewards/deploy.ts — resolve SENDx, discover share token from broadcasts or env, deploy RewardsManager, persist deployments/rewards.{chainId}.json.
- PR5 (tests, Base fork): deploy + wiring + sync mirroring; optional CFA smoke under env flag (encode/simulate only).
- (Later) Optional: IDA true-up and AA integration — explicitly out of scope here.

Testing strategy (Base fork)
- Deploy RewardsManager; assert pool exists and wiring to SENDx is correct when ABI supports verification.
- Arrange balances for at least one user (via impersonation + transfer or a known holder); call sync(user) and assert units = shareToken.balanceOf(user).
- Change balances and re-sync to verify unit updates; cover batchSync([...]).
- Optional CFA smoke (ENABLE_CFA_SMOKE=true): only encode/simulate a flow; no assumptions about passage of time.

Persistence
- deployments/rewards.{chainId}.json will include: rewardsManager, pool, sendx, shareToken, chainId, blockNumber.

Graphite workflow (stacking)
- Keep branch names short (<30 chars) and PRs atomic.
- This PR is docs-only for review.
- Verify Graphite tracking with gt ls; use gt submit for submission.

References (mirror-only; no custom patterns)
- Distribution Pools (GDA) — examples and guides:
  - https://docs.superfluid.org/docs/protocol/distributions/guides/pools
- SuperTokenV1Library usage (create/connect/update):
  - see Pool guides above; we follow library calls exactly.
- CFAv1 Forwarder helper (optional admin streaming):
  - https://docs.superfluid.org/docs/protocol/agreements/cfa/cfav1-forwarder
- Superfluid network addresses:
  - https://docs.superfluid.org/docs/reference/networks
- Repo examples to mirror (no new patterns):
  - scripts/wrapper/create.ts (viem simulate/write, canonical wrapper lookup)
  - test/wrapper.ts (fork impersonation, smoke patterns)
- ERC‑4626 broadcasts:
  - /Users/vict0xr/Documents/Send/send-earn-contracts/broadcast/DeploySendEarn.s.sol

