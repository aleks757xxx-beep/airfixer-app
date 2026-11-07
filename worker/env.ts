/** Привязки и секреты Worker (wrangler.jsonc + Settings → Runtime variables and secrets). */
export interface Env {
  ASSETS: Fetcher;
  BUCKET: R2Bucket;
  DB: D1Database;
  APP_PASSWORD?: string;
  BUFFER_API_KEY?: string;
  UPLOAD_TOKEN?: string;
}

export type AppBindings = { Bindings: Env };
