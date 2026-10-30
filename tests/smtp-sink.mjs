// Puits SMTP minimal pour les tests locaux : accepte tout, journalise, n'envoie rien.
import net from 'node:net';

const PORT = parseInt(process.env.SINK_PORT || '1025', 10);
const messages = [];

const server = net.createServer((socket) => {
  let buffer = '';
  let inData = false;
  let current = { from: '', to: [], data: '' };

  const send = (line) => socket.write(line + '\r\n');
  send('220 sink.local ESMTP');

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      if (inData) {
        if (line === '.') {
          inData = false;
          messages.push({ ...current, at: new Date().toISOString() });
          console.log(`[sink] message reçu: ${current.to.join(',')} (${current.data.length} octets)`);
          send('250 OK queued');
          current = { from: '', to: [], data: '' };
        } else {
          current.data += line + '\n';
        }
        continue;
      }

      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') {
        send('250-sink.local');
        send('250 SIZE 10485760');
      } else if (cmd === 'MAIL') {
        current.from = line; send('250 OK');
      } else if (cmd === 'RCPT') {
        current.to.push(line.replace(/^RCPT TO:<?/i, '').replace(/>?$/i, '')); send('250 OK');
      } else if (cmd === 'DATA') {
        inData = true; send('354 End data with <CR><LF>.<CR><LF>');
      } else if (cmd === 'QUIT') {
        send('221 Bye'); socket.end();
      } else if (cmd === 'RSET') {
        current = { from: '', to: [], data: '' }; send('250 OK');
      } else {
        send('250 OK');
      }
    }
  });

  socket.on('error', () => {});
});

server.listen(PORT, '127.0.0.1', () => console.log(`[sink] écoute SMTP sur 127.0.0.1:${PORT}`));

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
