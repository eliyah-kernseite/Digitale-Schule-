'use strict';

/** Daten für die Paywall: alle Lehrgänge mit Seminartiteln, damit man sieht, was man freischaltet. */
function paywallData(ctx, user) {
  const { learning } = ctx;
  const subjects = learning.subjects().map((s) => ({ ...s, seminars: learning.curriculum(s.id) }));
  const live = subjects.filter((s) => s.status === 'live');
  return {
    subjects,
    liveCount: live.length,
    seminarCount: live.reduce((n, s) => n + s.seminars.length, 0),
    sub: learning.subscriptionOf(user.id),
  };
}

module.exports = { paywallData };
