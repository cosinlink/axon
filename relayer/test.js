var config = require("./config");
const {Account} = require("muta-sdk")
const utils = require("@nervosnetwork/ckb-sdk-utils");
var inquirer = require('inquirer');
var chalkPipe = require('chalk-pipe');
// import { ecdsaSign, publicKeyCreate } from 'secp256k1';
const ECPair = require("@nervosnetwork/ckb-sdk-utils/lib/ecpair");
const {encode} =require("rlp")

function encode_batchMint( ) {
    const amount = 100n;

    const amount_array = new Uint8Array(16);
    amount_array.set( utils.hexToBytes(utils.toHexInLittleEndian( amount )) )

    const array = [[
        [
            utils.hexToBytes("0xf56924db538e77bb5951eb5ff0d02b88983c49c45eea30e8ae3e7234b311436c"),
            utils.hexToBytes("0x016cbd9ee47a255a6f68882918dcdd9e14e6bee1"),
            amount_array
        ]
    ]]

    return encode(array)
}

function test_rlp() {
    let arr =[
        utils.hexToBytes("0xf56924db538e77bb5951eb5ff0d02b88983c49c45eea30e8ae3e7234b311436c")
    ]


    // const amount = 100n;
    // const amount_array = new Uint8Array(16);
    // amount_array.set( utils.hexToBytes(utils.toHexInLittleEndian( amount )) )
    // arr = amount_array

    const arr_encode = encode(arr)
    console.log( utils.hexToBytes("0xf56924db538e77bb5951eb5ff0d02b88983c49c45eea30e8ae3e7234b311436c") )
    console.log( utils.bytesToHex(arr_encode) )
}

var questions = [
    {
        type: 'input',
        name: 'first_name',
        message: "Please enter return to lock sudt to crosschain locksript",
        validate: function(value) {
            return true;
        }
    }
];

function privateKeyToPKAndAddress() {
    const key = new ECPair.default(config.muta.privateKey, {compressed: true});
    console.log(key.publicKey)
    console.log(utils.bytesToHex(Account.addressFromPublicKey(key.publicKey)))
}

function main() {
    privateKeyToPKAndAddress()

    // const { signature } = ecdsaSign(utils.keccak( payload_bytes ), utils.toBuffer(config.muta.privateKey))
    const arr = encode_batchMint()
    const str = utils.bytesToHex(arr)
    console.log(str)
    const expect_str = "0xf851f84fb84df84ba2e1a0f56924db538e77bb5951eb5ff0d02b88983c49c45eea30e8ae3e7234b311436c96d594016cbd9ee47a255a6f68882918dcdd9e14e6bee19064000000000000000000000000000000"
    console.log(expect_str)

    console.log("\n\nobj_id")
    test_rlp()
}


main()