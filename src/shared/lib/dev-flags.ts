// Development-only behaviour switches, in one greppable place.
//
// Everything here is gated on `__DEV__`, which Metro replaces with a literal
// at build time — so these branches are dead code the minifier drops from a
// release bundle rather than a runtime check that could be flipped on by
// accident in production.

/**
 * Treat every molly colour and every creature species as unlocked.
 *
 * The Fishdex is a collection screen, so its whole point is that most of it is
 * hidden — which makes it impossible to review art or swim behaviour for
 * anything you haven't earned yet. In development that trade is backwards.
 *
 * NOTE THE BLAST RADIUS: this is applied inside `useUnlocks` and
 * `useSpeciesUnlocks`, so it also unlocks the focus-home species picker and
 * anything else derived from those hooks. That is deliberate — being able to
 * start a session as any species is the other half of "let me see how it
 * behaves" — but it does mean a dev build cannot be used to check how the
 * locked state looks. Flip this to `false` for that.
 */
export const DEV_UNLOCK_ALL = __DEV__;

/**
 * Show the "Add to tank" button in the Fishdex swim preview.
 *
 * Kept separate from `DEV_UNLOCK_ALL` because they fail differently. Unlocking
 * everything only changes what is VISIBLE; spawning WRITES — a completed
 * session row, with all the derived consequences that implies (see
 * `features/fishdex/api/use-dev-spawn-fish-mutation.ts`). Shipping the first
 * by accident would spoil a collection screen; shipping the second would
 * hand every user an infinite tank and fake stats.
 */
export const DEV_SPAWN_FISH = __DEV__;
