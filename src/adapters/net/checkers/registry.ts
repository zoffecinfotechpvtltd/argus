import type { CheckKind } from "@domain/entities";
import type { Checker, CheckerProvider } from "@ports/services";
import { IcmpChecker } from "@adapters/net/checkers/icmpChecker";
import { TcpChecker } from "@adapters/net/checkers/tcpChecker";
import { HttpChecker } from "@adapters/net/checkers/httpChecker";
import { SnmpChecker } from "@adapters/net/checkers/snmpChecker";
import { FortiGateApiChecker } from "@adapters/net/checkers/fortigateApiChecker";

export class DefaultCheckerProvider implements CheckerProvider {
  private checkers: Record<CheckKind, Checker>;

  constructor(instanceKey: Buffer) {
    this.checkers = {
      icmp: new IcmpChecker(),
      tcp: new TcpChecker(),
      http: new HttpChecker(),
      snmp: new SnmpChecker(instanceKey),
      fortigate_api: new FortiGateApiChecker(instanceKey),
    };
  }

  get(kind: CheckKind): Checker {
    return this.checkers[kind];
  }
}
