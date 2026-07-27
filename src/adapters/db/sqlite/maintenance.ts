import type { Database } from "bun:sqlite";
import type { DbMaintenance } from "@ports/services";
import { buildZip } from "@adapters/backup/zip";

export class SqliteDbMaintenance implements DbMaintenance {
  constructor(private db: Database) {}

  checkpoint(): void {
    this.db.exec("PRAGMA wal_checkpoint(FULL);");
  }

  close(): void {
    this.db.close();
  }

  buildZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
    return buildZip(entries);
  }
}
