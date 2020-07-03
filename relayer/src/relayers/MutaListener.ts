import {BlockSynchronizer, nexusTypes} from "hermit-purple-server";
import {safeParseJSON} from "muta-sdk/build/main/utils/common";
import {config} from "../config";
import {CkbRelayMessage, mutaCollection, MutaToCkbWitness, relayToCkbBuffer} from "../db";
import {BurnEvent, client, MutaRawEvent} from "../muta";
import {wait} from "../utils";
import fetch from "node-fetch";
import {ckb} from "../ckb";
import {Muta, Client} from "muta-sdk"
import {muta} from "hermit-purple-server/lib/muta";
import {sendUnlockTx} from "../consumers/sendUnlockTransaction";
const {unlockCrosschainContract} = require("../../../demo/src/centralized_crosschain_demo.js");


const debug = require("debug")("relayer:muta-listener");


export class MutaListener {
    async getLocalHeight() {
        return mutaCollection.getLatestHeight();
    }

    async get_block_hook_receipt(height: number | string) {
        if (typeof height == "number") {
            height = "0x" + height.toString(16);
        }

        const res = await fetch(config.muta.endpoint, {
            "headers": {
                "accept": "*/*",
                "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,lb;q=0.6",
                "content-type": "application/json"
            },
            // "referrer": "http://0.0.0.0:8000/graphiql",
            // "referrerPolicy": "no-referrer-when-downgrade",
            "body": `{\"operationName\":null,\"variables\":{},\"query\":\"{\\n  getBlockHookReceipt(height: \\\"${height}\\\") {\\n    height\\n    events {\\n      data\\n      topic\\n      service\\n    }\\n    stateRoot\\n  }\\n}\\n\"}`,
            "method": "POST",
            // "mode": "cors",
            // "credentials": "omit"
        });

        const data = (await res.json()).data

        return data ? data.getBlockHookReceipt : null
    }

    start() {
        const self = this;

        (async () => {
            while (1) {
                try {
                    const remoteHeight = Number(await client.getLatestBlockHeight());
                    const currentHeight = (await this.getLocalHeight()) + 1;

                    debug(`muta local: ${currentHeight}, remote: ${remoteHeight} `);

                    if (currentHeight >= Number(remoteHeight)) {
                        if (currentHeight > Number(remoteHeight) + 1) {
                            debug('muta db not match remote chain')
                            return
                        }
                        debug(`waiting for remote new block`);
                        await wait(1000);
                        continue;
                    }

                    const muta_receipt = await this.get_block_hook_receipt(currentHeight)
                    // current block has not been executed
                    if (!muta_receipt) {
                        await wait(1000);
                        continue;
                    }

                    const mutaEvents = muta_receipt.events
                    if (mutaEvents.length > 0 ) {
                    // if (mutaEvents.length == 0 ) {
                        console.log("found muta->ckb: ", muta_receipt);
                        debug(
                            `found ${mutaEvents.length} muta->ckb events in height: ${currentHeight} of muta`
                        )
                        await this.onSudtBurnToCkb(currentHeight, mutaEvents);
                    }

                    await mutaCollection.append( currentHeight )
                } catch (e) {
                    console.error(e);
                }
            }
        })();
    }

    private async onSudtBurnToCkb(currentHeight: number, events:any[]) {
        const burnEvents = events.map<BurnEvent>((event) => {
             const data = JSON.parse(event.data)
             return {
                 asset_id: data.id,
                 ckb_receiver: data.receiver,
                 amount: BigInt(data.amount),
             } as BurnEvent
        })

        const rawWitness ={
            messages: [ {
                header: {
                    height: BigInt(currentHeight),
                },
                events: burnEvents,
            } as CkbRelayMessage],
            proof: ""
        } as MutaToCkbWitness


        console.log("start unlockCrosschainContract")
        const txHash = await unlockCrosschainContract(config, rawWitness)
        if (txHash) {
            await MutaListener.waitForTx(txHash)
        }
    }

    private static async waitForTx(txHash: string) {
        while (true) {
            const tx = await ckb.rpc.getTransaction(txHash);
            try {
                // console.log(`tx ${txHash} status: ${tx.txStatus.status}`);
                if (tx.txStatus.status === "committed") {
                    debug(
                        `send unlockTx to ckb successfully!! \n
                         tx: ${txHash}, committed
                        `
                    )
                    return;
                }
            } catch (e) {
                console.log({ e, tx, txHash });
            }
            await wait(1000);
        }
    }

}
