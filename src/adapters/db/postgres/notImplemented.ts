/** Placeholder for a port not yet given a Postgres implementation — every method throws a clear,
 * specific error naming the repo instead of the app either failing to boot at all (blocking work on
 * the repos that ARE ready) or silently doing nothing (a wrong-answer bug, worse than a loud one).
 * See SAAS_GAPS.md for which milestone ports each of these. Remove an entry from here the moment
 * its real Postgres adapter is written — this function existing for a given repo IS the tracked gap. */
export function notYetPortedRepo<T extends object>(name: string): T {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        return (..._args: unknown[]) => {
          throw new Error(
            `${name}.${prop}() has no Postgres implementation yet (saas mode) — see SAAS_GAPS.md for which milestone ports this repo. ` +
              `Not a data bug: this feature simply isn't available in saas mode yet.`
          );
        };
      },
    }
  ) as T;
}
