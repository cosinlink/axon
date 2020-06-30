import _ from "lodash";
import { ckb } from "../ckb";
import { config } from "../config";
import { ckbCollection, relayToMutaBuffer } from "../db";
import {CkbMessage, crossCKBService, CkbTx, BatchMintSudt, MintSudt, MessagePayload} from "../muta";
import { toCKBRPCType } from "../parse";
import { wait } from "../utils";
import {utils} from "muta-sdk"
import {Vec} from "muta-sdk/build/main/types/scalar";
import {encode} from "rlp"
import { ecdsaSign, publicKeyCreate } from 'secp256k1';


const debug = require("debug")("relayer:ckb-listener");

interface Options {
  output: typeof config.ckb.output;
}

export class CkbListener {
  options: Options;

  constructor(options?: Options) {
    this.options = { output: config.ckb.output };
  }

  async getLocalHeight() {
    return ckbCollection.getLatestCKBKHeight();
  }

  start() {
    const targetOutput = this.options.output;

    (async () => {
      while (1) {
        try {
          const remoteHeight = Number(await ckb.rpc.getTipBlockNumber());
          const currentHeight = (await this.getLocalHeight()) + 1;

          debug(`local: ${currentHeight}, remote: ${remoteHeight} `);

          if (currentHeight > Number(remoteHeight)) {
            debug(`waiting for remote new block`);
            await wait(1000);
            continue;
          }

          const block = await ckb.rpc.getBlockByNumber(BigInt(currentHeight));

          await this.onNewBlock(block.header);
          await ckbCollection.append(block);

          debug(
              `---- block of ${block.transactions.length} txs in height: ${currentHeight}`
          );

          if (block.transactions.length > 1) {
            debug(
                JSON.stringify( block.transactions[1], null, 2)
            )
          }
          const crossTxs = block.transactions.filter(tx => {
            return (
              tx.outputs.length === 1 &&
              tx.outputs.find(output => {
                return (
                  // output.type?.codeHash === targetOutput.type.codeHash &&
                  // output.type?.hashType === targetOutput.type.hashType &&
                  _.isEqual(output.lock, targetOutput.lock)
                );
              })
            );
          });

          debug(
            `found ${crossTxs.length} cross txs of ${block.transactions.length} txs in height: ${currentHeight}`
          );

          // if (!crossTxs.length) continue;
          await this.onSUDTLockedToCrossCell(currentHeight, crossTxs);

          await wait(5000);
        } catch (e) {
          console.error(e);
        }
      }
    })();
  }

  private async onNewBlock(header: CKBComponents.BlockHeader) {
    await relayToMutaBuffer.appendHeader(toCKBRPCType(header));
  }

  private async onSUDTLockedToCrossCell(
    currentHeight: number,
    crossTxs: CKBComponents.Transaction[]
  ) {
    let headers = await relayToMutaBuffer.readAllHeaders();
    debug(`start relay to muta`);
    // await crossCKBService.update_headers({ headers });
    // await relayToMutaBuffer.flushHeaders();

    const batchMint = {
      batch: [],
    } as BatchMintSudt


    const payload_bytes = encode_batchMint( batchMint )
    const { signature } = ecdsaSign(utils.keccak( payload_bytes ), utils.toBuffer(config.muta.privateKey))
    const messagePayload = {
      payload: utils.toHex(payload_bytes),
      signature: utils.toHex( signature )
    } as MessagePayload;

    const receipt = await crossCKBService.submit_message(messagePayload);

    debug(`relay to muta successful`);
    debug(receipt);
  }
}

function encode_batchMint( batchMint: BatchMintSudt ): Buffer {

  const array = [ batchMint.batch.map(
      mintSudt => ([
          mintSudt.id,
          mintSudt.receiver,
          mintSudt.amount
      ])
  ) ]

  return encode(array)
}