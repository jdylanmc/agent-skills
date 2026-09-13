// Deterministic process seam, not a Copilot SDK or model simulation.
process.on('SIGTERM', () => {});
process.on('message', (packet) => {
  if (packet.mode === 'complete') {
    process.send({ idle: true });
    process.send({ result: { status: 'implemented' } }, () => process.disconnect());
  } else setInterval(() => {}, 1000);
});
