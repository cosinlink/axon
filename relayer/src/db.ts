import { Validator } from "muta-sdk/build/main/types/struct";
import { join } from "path";
import { BurnEvent, CkbHeader, crossCKBService, MessagePayload } from "./muta";
import { toCKBRPCType } from "./parse";

const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");

const adapter = new FileSync(join(__dirname, "../data/db.json"));
const db = low(adapter);

db.defaults({
  muta: {},
  ckb: {},
  ckbBuffer: [],
  mutaBuffer: [],
  mutaHeaderBuffer: []
}).write();

class CkbCollection {
  collection = db.get("ckb");

  async append(block: CKBComponents.Block) {
    this.collection.set("height", Number(block.header.number)).write();
  }

  async getLatestCKBKHeight(): Promise<number> {
    return this.collection.get("height", -1).value();
  }

  async markBlockHandled(height: number) {
    this.collection.push({ height }).write();
  }
}

class MutaCollection {
  collection = db.get("muta");

  async getLatestHeight(): Promise<number> {
    return this.collection.get("height", 0).value();
  }

  async append(height: number) {
    this.collection.set("height", height).write();
  }
}

type BufferStatus = "pending" | "committed" | "proposed";

export interface CkbRelayMessage {
  header: {
    height: number;
    validatorVersion: string;
    validators: Validator[];
  };
  events: BurnEvent[];
  proof: string;
}

export interface CrossMutaToCkbMessage {
  // muta block height
  height: number;
  txHash: null | string;
  status: BufferStatus;
  data: CkbRelayMessage;
}

class RelayToCkbBuffer {
  private buffer = db.get("ckbBuffer");

  async append(item: CrossMutaToCkbMessage) {
    this.buffer.push(item).write();
  }

  async readPending(): Promise<CrossMutaToCkbMessage[]> {
    return this.buffer.filter({ status: "pending" }).value() ?? [];
  }

  async markAsPending(height: number, txHash: string) {
    this.buffer
      .filter({ height })
      .each((message: CrossMutaToCkbMessage) => {
        message.status = "pending";
        message.txHash = txHash;
      })
      .write();
  }

  async markAsCommitted(txHash: string) {
    if (!txHash) return;
    this.buffer
      .filter({ txHash, status: "pending" })
      .each((tx: CrossMutaToCkbMessage) => {
        tx.status = "committed";
      })
      .write();
  }

  async readProposed(): Promise<CrossMutaToCkbMessage[]> {
    return this.buffer.filter({ status: "proposed" }).value() ?? [];
  }

  async readLastCommitted(): Promise<CrossMutaToCkbMessage | null> {
    return this.buffer.last().value() ?? null;
  }

  async readAll(): Promise<CrossMutaToCkbMessage[]> {
    return this.buffer.value() ?? [];
  }

  flush() {
    // db.set("ckbBuffer", []);
  }
}

export interface CrossCkbToMutaMessage {
  height: number;
  status: BufferStatus;
  txHash: string | null;
  data: MessagePayload;
}

class RelayToMutaBuffer {
  private buffer = db.get("mutaBuffer");
  private headerBuffer = db.get("mutaHeaderBuffer");

  async append(item: CrossCkbToMutaMessage) {
    this.buffer.push(item).write();
  }

  async appendHeader(header: CkbHeader) {
    this.headerBuffer.push(toCKBRPCType(header)).write();
  }

  async readAllHeaders() {
    return this.headerBuffer.value() as CkbHeader[];
  }

  async readProposed(): Promise<CrossCkbToMutaMessage> {
    return this.buffer.filter({ status: "proposed" }).value();
  }

  async readAll(): Promise<CrossCkbToMutaMessage[]> {
    return this.buffer.value() ?? [];
  }

  async flushHeaders() {
    db.set("mutaHeaderBuffer", []).write();
  }
}

export const ckbCollection = new CkbCollection();

export const mutaCollection = new MutaCollection();

export const relayToCkbBuffer = new RelayToCkbBuffer();

export const relayToMutaBuffer = new RelayToMutaBuffer();
