import { config } from "./config";
import { prisma } from "./db";
import { createApp } from "./app";

async function main() {
  await prisma.$connect();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`\n  API lista en http://localhost:${config.port}  (base de datos conectada)\n`);
  });
}

main().catch((err) => {
  console.error("No se pudo iniciar el servidor:", err);
  process.exit(1);
});
