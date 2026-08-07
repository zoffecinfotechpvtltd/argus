declare module "net-snmp" {
  export const Version1: number;
  export const Version2c: unknown;
  export const Version3: number;

  export const AuthProtocols: Record<"none" | "md5" | "sha" | "sha224" | "sha256" | "sha384" | "sha512", number>;
  export const PrivProtocols: Record<"none" | "des" | "aes" | "aes256b" | "aes256r", number>;
  export const SecurityLevel: Record<"noAuthNoPriv" | "authNoPriv" | "authPriv", number>;

  export interface SessionOptions {
    timeout?: number;
    retries?: number;
    version?: unknown;
  }

  export interface V3User {
    name: string;
    level: number;
    authProtocol?: number;
    authKey?: string;
    privProtocol?: number;
    privKey?: string;
  }

  export interface VarBind {
    oid: string;
    type: number;
    value: unknown;
  }

  export interface Session {
    get(oids: string[], callback: (err: unknown, varbinds: VarBind[]) => void): void;
    /** Walks a table OID, collecting every row up to maxRepetitions per GETBULK — the callback
     * receives `{ [rowIndex: string]: { [columnNumber: string]: value } }`. */
    table(oid: string, maxRepetitions: number, callback: (err: unknown, table: Record<string, Record<string, unknown>>) => void): void;
    close(): void;
  }

  export function createSession(host: string, community: string, options?: SessionOptions): Session;
  export function createV3Session(host: string, user: V3User, options?: SessionOptions): Session;

  const snmp: {
    Version1: number;
    Version2c: unknown;
    Version3: number;
    AuthProtocols: typeof AuthProtocols;
    PrivProtocols: typeof PrivProtocols;
    SecurityLevel: typeof SecurityLevel;
    createSession: typeof createSession;
    createV3Session: typeof createV3Session;
  };
  export default snmp;
}
