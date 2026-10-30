
import { isUrlAllowed, safeFetch, isPrivateIp } from '../src/fetcher.js';
const cases = ['http://192.168.1.200/','http://127.0.0.1:3000/','http://localhost/','http://169.254.169.254/latest','ftp://example.com/','http://[::1]/','http://10.0.0.1/','https://example.com/'];
for (const c of cases) console.log(c.padEnd(38), JSON.stringify(await isUrlAllowed(c)).slice(0,90));
console.log('ipv6 ::ffff:192.168.1.1 privé ?', isPrivateIp('::ffff:192.168.1.1'));
try { const r = await safeFetch('https://example.com/'); console.log('safeFetch OK', r.status, r.bytes,'o', r.elapsedMs,'ms', (r.text.match(/<title>(.*?)<\/title>/)||[])[1]); } catch(e){ console.log('safeFetch ERR', e.code, e.message); }
