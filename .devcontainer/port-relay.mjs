// Bridges the container's own address to the dev server's loopback listeners so
// Docker's published ports reach them (the dev runner binds loopback on purpose).
// usage: node port-relay.mjs <container-ip> <port>...
import * as NodeNet from "node:net";

const [listenHost, ...ports] = process.argv.slice(2);
// The server binds 127.0.0.1, Vite binds ::1; do not depend on how "localhost" resolves.
const loopbacks = ["127.0.0.1", "::1"];

function connectLoopback(port, onConnect, onFail, index = 0) {
  const upstream = NodeNet.connect({ host: loopbacks[index], port });
  upstream.once("connect", () => onConnect(upstream));
  upstream.once("error", () => {
    upstream.destroy();
    if (index + 1 < loopbacks.length) connectLoopback(port, onConnect, onFail, index + 1);
    else onFail();
  });
}

for (const port of ports.map(Number)) {
  NodeNet.createServer((client) => {
    client.pause();
    connectLoopback(
      port,
      (upstream) => {
        const close = () => {
          client.destroy();
          upstream.destroy();
        };
        client.on("error", close).on("close", close);
        upstream.on("error", close).on("close", close);
        client.pipe(upstream).pipe(client);
        client.resume();
      },
      () => client.destroy(),
    );
  }).listen(port, listenHost);
}
