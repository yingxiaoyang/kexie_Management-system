import { env } from './config/env.js';
import { createApp } from './app.js';

const app = createApp();

app.listen(env.port, () => {
  console.log(`Kexie server is running at http://127.0.0.1:${env.port}`);
});
