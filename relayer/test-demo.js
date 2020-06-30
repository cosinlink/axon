
// import fetch from 'node-fetch';
const fetch = require("node-fetch");
const config = require("./config.json");


let height;
let tip_height;
let txHash;

async function run_demo() {
    // ckb crosschain to muta
    console.log("1. relayer call ckb-handler service to submit crosschain message, which mints sudt:\n");
    get_tip_height();
    await sleep(2000);
    submit_message();
    console.log("tx succedd and txHash is:\n")
    await sleep(2000);
    console.log(txHash);
    console.log("\nget tx receipt by txHash:\n");
    await sleep(5000);
    get_tx_receipt();

    // muta crosschain to ckb
    get_tip_height();
    await sleep(2000);
    console.log("\n2. user call ckb-sudt to burn sudt and get burn-sudt-proof:\n");
    console.log("sending txHash and got txHash:\n");
    burn_sudt();
    await sleep(2000);
    console.log(txHash);
    await sleep(5000);
    console.log("\nget tx receipt by txHash:\n");
    get_tx_receipt();
    await sleep(2000);
    console.log("\nget block hook receipt by height:\n");
    get_block_hook_receipt();
}

run_demo()

function get_tx_receipt() {
    fetch(config.muta.endpoint, {
        "headers": {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,lb;q=0.6",
            "content-type": "application/json"
        },
        "referrer": "http://0.0.0.0:8000/graphiql",
        "referrerPolicy": "no-referrer-when-downgrade",
        "body": `{\"operationName\":null,\"variables\":{},\"query\":\"{\\n  getReceipt(txHash: \\\"${txHash}\\\") {\\n    height\\n    response {\\n      serviceName\\n      response {\\n        code\\n        succeedData\\n        errorMessage\\n      }\\n    }\\n    events {\\n      data\\n      topic\\n      service\\n    }\\n  }\\n}\\n\"}`,
        "method": "POST",
        "mode": "cors"
    }).then(res => res.json()).then(json => json.data.getReceipt).then(receipt => { height = receipt.height; console.log(receipt); });
}


function get_block_hook_receipt() {
    fetch(config.muta.endpoint, {
        "headers": {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,lb;q=0.6",
            "content-type": "application/json"
        },
        "referrer": "http://0.0.0.0:8000/graphiql",
        "referrerPolicy": "no-referrer-when-downgrade",
        "body": `{\"operationName\":null,\"variables\":{},\"query\":\"{\\n  getBlockHookReceipt(height: \\\"${height}\\\") {\\n    height\\n    events {\\n      data\\n      topic\\n      service\\n    }\\n    stateRoot\\n  }\\n}\\n\"}`,
        "method": "POST",
        "mode": "cors",
        "credentials": "omit"
    }).then(res => res.json()).then(json => json.data.getBlockHookReceipt).then(console.log);
}

function get_tip_height() {
    fetch(config.muta.endpoint, {
        "headers": {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,lb;q=0.6",
            "content-type": "application/json"
        },
        "referrer": "http://0.0.0.0:8000/graphiql",
        "referrerPolicy": "no-referrer-when-downgrade",
        "body": "{\"operationName\":null,\"variables\":{},\"query\":\"{\\n  getBlock(height: null) {\\n    header {\\n      height\\n    }\\n  }\\n}\\n\"}",
        "method": "POST",
        "mode": "cors",
        "credentials": "omit"
    }).then(res => res.json()).then(json => json.data.getBlock.header.height).then(height => parseInt(height, 16) + 19).then(height => '0x' + height.toString(16)).then(height => { tip_height = height; });
}

function submit_message() {
    fetch(config.muta.endpoint, {
        "headers": {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,lb;q=0.6",
            "content-type": "application/json"
        },
        "referrer": "http://0.0.0.0:8000/graphiql",
        "referrerPolicy": "no-referrer-when-downgrade",
        "body": `{\"operationName\":\"submit_message\",\"variables\":{},\"query\":\"mutation submit_message {\\n  unsafeSendTransaction(inputRaw: {serviceName: \\\"ckb_handler\\\", method: \\\"submit_message\\\", payload: \\\"{\\\\\\\"payload\\\\\\\":\\\\\\\"0xf8a0f89eb84df84ba2e1a0f56924db538e77bb5951eb5ff0d02b88983c49c45eea30e8ae3e7234b311436c96d594016cbd9ee47a255a6f68882918dcdd9e14e6bee19064000000000000000000000000000000b84df84ba2e1a0f56924db538e77bb5951eb5ff0d02b88983c49c45eea30e8ae3e7234b311436c96d594016cbd9ee47a255a6f68882918dcdd9e14e6bee19064000000000000000000000000000000\\\\\\\", \\\\\\\"signature\\\\\\\": \\\\\\\"0x02a8c1d0360f175d76089eda3cb4e50e223539e96548017fcf7cebc5fb12790a5b7d71fdc6a7556d27f2a6062069ce347bb25eb9a718b6dc27e03342eba593ea\\\\\\\"}\\\", timeout: \\\"${tip_height}\\\", nonce: \\\"0x9db2d7efe2b61a88827e4836e2775d913a442ed2f9096ca1233e479607c27cf7\\\", chainId: \\\"0xb6a4d7da21443f5e816e8700eea87610e6d769657d6b8ec73028457bf2ca4036\\\", cyclesPrice: \\\"0x9\\\", cyclesLimit: \\\"0x99999\\\"}, inputPrivkey: \\\"0x30269d47fcf602b889243722b666881bf953f1213228363d34cf04ddcd51dfd2\\\")\\n}\\n\"}`,
        "method": "POST",
        "mode": "cors",
        "credentials": "omit"
    }).then(res => res.json()).then(json => { txHash = json.data.unsafeSendTransaction; return txHash; });
}

function burn_sudt() {
    fetch(config.muta.endpoint, {
        "headers": {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,lb;q=0.6",
            "content-type": "application/json"
        },
        "referrer": "http://0.0.0.0:8000/graphiql",
        "referrerPolicy": "no-referrer-when-downgrade",
        "body": `{\"operationName\":\"burn_sudt\",\"variables\":{},\"query\":\"mutation burn_sudt {\\n  unsafeSendTransaction(inputRaw: {serviceName: \\\"ckb_sudt\\\", method: \\\"burn_sudt\\\", payload: \\\"{\\\\\\\"id\\\\\\\":\\\\\\\"0xf56924db538e77bb5951eb5ff0d02b88983c49c45eea30e8ae3e7234b311436c\\\\\\\", \\\\\\\"receiver\\\\\\\": \\\\\\\"0x016cbd9ee47a255a6f68882918dcdd9e14e6bee1\\\\\\\", \\\\\\\"amount\\\\\\\": 100}\\\", timeout: \\\"${tip_height}\\\", nonce: \\\"0x9db2d7efe2b61a88827e4836e2775d913a442ed2f9096ca1233e479607c27cf7\\\", chainId: \\\"0xb6a4d7da21443f5e816e8700eea87610e6d769657d6b8ec73028457bf2ca4036\\\", cyclesPrice: \\\"0x9\\\", cyclesLimit: \\\"0x99999\\\"}, inputPrivkey: \\\"0x30269d47fcf602b889243722b666881bf953f1213228363d34cf04ddcd51dfd2\\\")\\n}\\n\"}`,
        "method": "POST",
        "mode": "cors"
    }).then(res => res.json()).then(json => { txHash = json.data.unsafeSendTransaction; });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

