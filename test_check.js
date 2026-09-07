const fs = require('fs');
const content = fs.readFileSync('api/src/matches/poller.test.ts', 'utf8');

const hasTryCatchTest = content.includes('scoreResults');
const hasCatchTest = content.includes('success: false');
const hasThrowTest = content.includes('throw res.err');

console.log('hasTryCatchTest:', hasTryCatchTest);
console.log('hasCatchTest:', hasCatchTest);
console.log('hasThrowTest:', hasThrowTest);
