declare module "net-snmp" {
  export const Version2c: unknown;

  export interface SessionOptions {
    timeout?: number;
    retries?: number;
    version?: unknown;
  }

  export interface VarBind {
    oid: string;
    type: number;
    value: unknown;
  }

  export interface Session {
    get(oids: string[], callback: (err: unknown, varbinds: VarBind[]) => void): void;
    close(): void;
  }

  export function createSession(host: string, community: string, options?: SessionOptions): Session;

  const snmp: {
    Version2c: unknown;
    createSession: typeof createSession;
  };
  export default snmp;
}
