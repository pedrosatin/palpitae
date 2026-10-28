const { resolveCanonicalScore } = require('./api/src/matches/sync.js');
console.log(resolveCanonicalScore({
  duration: 'PENALTY_SHOOTOUT',
  fullTime: { home: 1, away: 2 },
  regularTime: { home: 1, away: 1 },
  extraTime: { home: 0, away: 0 },
  penalties: { home: 2, away: 1 },
}));
