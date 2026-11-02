import { createApp } from './app.js';
import { config } from './config.js';

createApp().listen(config.port, () => {
  console.log(`F1 Career Archive API running on http://localhost:${config.port}`);
});
