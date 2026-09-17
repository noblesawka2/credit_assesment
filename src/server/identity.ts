import type { IncomingMessage } from "node:http";
import type { Actor } from "../domain/access.ts";
export interface IdentityAdapter {
  authenticate(request: IncomingMessage): Promise<Actor | null>;
}
export const unavailableIdentity: IdentityAdapter = {
  async authenticate() { return null; }
};
