// Старая версия (worker/legacy.js) — работает на «/», пока новые экраны её не заменят.
import type { Env } from "./env";

declare const legacy: {
  fetch(request: Request, env: Env): Promise<Response>;
  scheduled(event: ScheduledController, env: Env): Promise<void>;
};
export default legacy;
