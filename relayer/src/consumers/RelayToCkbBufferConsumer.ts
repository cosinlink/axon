import { ckb } from "../ckb";
import { CkbRelayMessage, relayToCkbBuffer } from "../db";
import { wait } from "../utils";
import { sendUnlockTx } from "./sendUnlockTransaction";

export class RelayToCkbBufferConsumer {
  start() {
    (async () => {
      while (1) {
        await this.pollPending();
        await this.pollProposed();

        await wait(1000);
      }
    })();
  }

  private async pollProposed() {
    const proposed = await relayToCkbBuffer.readProposed();
    const messages = proposed.map<CkbRelayMessage>(p => p.data);

    if (!messages.length) return;

    const txHash = await sendUnlockTx(messages);

    if (txHash) {
      for (const message of proposed) {
        await relayToCkbBuffer.markAsPending(message.height, txHash);
      }
    }
  }

  private async pollPending() {
    const pending = await relayToCkbBuffer.readPending();

    for (let message of pending) {
      const tx = await ckb.rpc.getTransaction(message.txHash!);
      if (tx.txStatus.status === CKBComponents.TransactionStatus.Committed) {
        await relayToCkbBuffer.markAsCommitted(tx.transaction.hash);
      }
    }
  }
}
