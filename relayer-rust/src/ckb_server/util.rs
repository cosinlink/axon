use crate::ckb_server::{
    indexer::{
        IndexerRpcClient, SearchKey, ScriptType, Order, Tip, Cell, Tx,
        Pagination,
    },
    centralized_witness::{
        gen_witness,
        gen_crosschain_data,
    },
};

use ckb_types::{
    bytes::Bytes,
    core::{cell::resolve_transaction, Capacity, Cycle, ScriptHashType, TransactionBuilder, TransactionView},
    packed,
    prelude::*,
    H160, H256,
};

use ckb_sdk::{
    rpc::{
        HttpRpcClient,
        LiveCell, Script,
    },
    GenesisInfo,
    constants::{
        SIGHASH_TYPE_HASH
    },
};
use ckb_crypto::secp::{Generator, Privkey, SECP256K1};
use ckb_hash::{blake2b_256, new_blake2b};
use ckb_jsonrpc_types::{
    CellDep, LockHashIndexState, Script as JsonScript, ScriptHashType as JsonScriptHashType, Uint32, JsonBytes,
};
use std::convert::{TryInto, TryFrom};
use faster_hex::{hex_decode, hex_string};
use lazy_static::lazy_static;
use ckb_types::packed::{Byte32, Uint64};
use crate::config::{Loader, ConfigScript};
use ckb_sdk::rpc::CellInput;

const TX_FEE: u64 = 1_0000_0000;
const RELAYER_CONFIG_NAME: &str = "relayer_config.json";
const SIGNATURE_SIZE: usize = 65;

pub fn get_privkey_from_hex(privkey_hex: String) -> secp256k1::SecretKey {
    let mut privkey_bytes = [0u8; 32];
    hex_decode(&privkey_hex.as_bytes()[2..], &mut privkey_bytes);
    secp256k1::SecretKey::from_slice(&privkey_bytes[..]).unwrap()
}

pub fn gen_lock_args(privkey_hex: String) -> H160 {
    let privkey = get_privkey_from_hex(privkey_hex);
    let pubkey = secp256k1::PublicKey::from_secret_key(&SECP256K1, &privkey);

    let lock_arg = H160::from_slice(&blake2b_256(&pubkey.serialize()[..])[0..20])
        .expect("Generate hash(H160) from pubkey failed");
    dbg!(hex_string(&lock_arg.0[..]));
    lock_arg
}

pub fn gen_lock_hash(privkey_hex: String) -> H256 {
    let lock_arg = gen_lock_args(privkey_hex);
    let lock_script = packed::Script::new_builder()
        .code_hash(SIGHASH_TYPE_HASH.pack())
        .hash_type(ScriptHashType::Type.into())
        .args(Bytes::from(lock_arg.as_bytes().to_vec()).pack())
        .build();

    let lock_hash: H256 = lock_script.calc_script_hash().unpack();
    println!("lock_hash: {:?}", hex_string(&lock_hash.0[..]));

    lock_hash
}

pub fn gen_unlock_sudt_tx(
    genesis_info: &GenesisInfo,
    ckb_client: &mut HttpRpcClient,
    ckb_indexer_client: &mut IndexerRpcClient
) -> packed::Transaction {
    let relayer_config = Loader::default().load_relayer_config(RELAYER_CONFIG_NAME);
    let validator_privkey_hex = relayer_config["ckb"]["privateKey"].as_str().expect("validator private key invalid");
    let secp256_dep: packed::CellDep = genesis_info.sighash_dep();
    let deploy_tx_hash = {
        let str = relayer_config["deployTxHash"].as_str().expect("deployTxHash invalid");
        let mut dst = [0u8; 32];
        hex_decode(&str.as_bytes()[2..], &mut dst).map_err(|e| panic!("deploy_tx_hash decode error: {}", e));
        packed::Byte32::from_slice(dst.as_ref()).expect("deployTxHash to Byte32 failed")
    };

    let crosschain_cell_tx_hash = {
        let str = relayer_config["createCrosschainCellTxHash"].as_str().expect("createCrosschainCellTxHash invalid");
        let mut dst = [0u8; 32];
        hex_decode(&str.as_bytes()[2..], &mut dst).map_err(|e| panic!("crosschain_cell_tx_hash decode error: {}", e));
        packed::Byte32::from_slice(dst.as_ref()).expect("createCrosschainCellTxHash to Byte32 failed")
    };

    let cross_type_out_point = packed::OutPoint::new_builder()
        .tx_hash(deploy_tx_hash.clone())
        .index(1u32.pack())
        .build();
    let cross_lock_out_point = packed::OutPoint::new_builder()
        .tx_hash(deploy_tx_hash.clone())
        .index(2u32.pack())
        .build();
    let crosschain_cell_out_point = packed::OutPoint::new_builder()
        .tx_hash(crosschain_cell_tx_hash.clone())
        .index(1u32.pack())
        .build();

    // get crosschain cell
    let (input_ckb, input_data) = {
        let cell_with_status = ckb_client.get_live_cell(crosschain_cell_out_point.clone(), true).expect("get_live_cell error");
        let cell_info = cell_with_status.cell.expect("cell is none");

        let input_ckb = cell_info.output.capacity.value();
        dbg!(input_ckb);
        let cell_data = cell_info.data.expect("cell data is none");

        dbg!(hex_string(cell_data.hash.as_bytes()));
        (input_ckb, cell_data.content.into_bytes())
    };

    // TODO debug
    dbg!(input_ckb);
    println!("input_data.to_vec(): {:?}", input_data.to_vec());

    // cell deps
    let cross_type_script_dep = packed::CellDep::new_builder()
        .out_point(cross_type_out_point.clone())
        .build();

    let cross_lock_script_dep = packed::CellDep::new_builder()
        .out_point(cross_lock_out_point.clone())
        .build();

    // lockscript && typescript
    let cross_lockscript: Script = {
        let config_script = serde_json::from_str::<ConfigScript>(relayer_config["crosschainLockscript"].to_string().as_ref()).unwrap();
        config_script.try_into().unwrap()
    };
    let validators_lockscript: Script = {
        let config_script = serde_json::from_str::<ConfigScript>(relayer_config["validatorsLockscript"].to_string().as_ref()).unwrap();
        config_script.try_into().unwrap()
    };
    let cross_typescript: Script = {
        let config_script = serde_json::from_str::<ConfigScript>(relayer_config["crosschainTypescript"].to_string().as_ref()).unwrap();
        config_script.try_into().unwrap()
    };

    // Todo debug
    println!("cross_lockscript: {:?}", cross_lockscript.clone());
    println!("validators_lockscript: {:?}", validators_lockscript.clone());
    println!("cross_typescript: {:?}", cross_typescript.clone());

    // get input from crosschainCell
    let input = packed::CellInput::new_builder()
        .previous_output(crosschain_cell_out_point.clone())
        .build();
    let mut inputs = vec![input];

    // generate output
    // let output_ckb = 20_000_000_000_000u64;
    let output_ckb = input_ckb;
    let output = packed::CellOutput::new_builder()
        .capacity(output_ckb.pack())
        .lock(validators_lockscript.into())
        .type_(Some(packed::Script::from(cross_typescript)).pack())
        .build();
    let mut outputs = vec![output];

    // outputs_data
    let mut outputs_data: Vec<Bytes> = vec![input_data];

    // add fee payer
    let lock_args = gen_lock_args(validator_privkey_hex.to_owned());
    let (inputs_payer, actual_capacity, lock_payer) =
        collect_live_inputs(ckb_indexer_client, 1000_0000, lock_args);
    inputs.extend(inputs_payer);

    let fee_change: u64 = actual_capacity - TX_FEE;
    outputs.push(
        packed::CellOutput::new_builder()
            .capacity(fee_change.pack())
            .lock(lock_payer.into())
            .build()
    );
    outputs_data.push(Bytes::new());

    // prepare witness for WitnessArgs.InputType
    let cc_witness: Vec<u8> = gen_witness();
    let witness = packed::WitnessArgs::new_builder()
        .input_type(Some(Bytes::from(cc_witness)).pack())
        .build();

    dbg!("inputs_len = ", inputs.len(), "outputs_len=", outputs.len(), "outputs_data_len=", outputs_data.len());

    // build transaction
    let tx = TransactionBuilder::default()
        .inputs(inputs)
        .outputs(outputs)
        .outputs_data(outputs_data.pack())
        .cell_dep(secp256_dep)
        .cell_dep(cross_lock_script_dep)
        .cell_dep(cross_type_script_dep)
        .build();

    // sign
    let bytes = hex::decode(&validator_privkey_hex.as_bytes()[2..]).unwrap();
    let privkey = Privkey::from_slice(bytes.as_ref());

    println!("pubkey of validator: {:?}", privkey.pubkey().unwrap().to_string());

    let tx = sign_tx(tx, &privkey);
    let tx_hash: [u8; 32] = tx.hash().unpack();

    dbg!(hex_string(&tx_hash[..]).unwrap());
    tx.data()
}

pub fn sign_tx(tx: TransactionView, key: &Privkey) -> TransactionView {
    const SIGNATURE_SIZE: usize = 65;

    let witnesses_len = tx.witnesses().len();
    let tx_hash = tx.hash();
    let mut signed_witnesses: Vec<packed::Bytes> = Vec::new();
    let mut blake2b = new_blake2b();
    let mut message = [0u8; 32];
    blake2b.update(&tx_hash.raw_data());
    // digest the first witness
    let witness = packed::WitnessArgs::default();
    let zero_lock: Bytes = {
        let mut buf = Vec::new();
        buf.resize(SIGNATURE_SIZE, 0);
        buf.into()
    };
    let witness_for_digest = witness
        .clone()
        .as_builder()
        .lock(Some(zero_lock).pack())
        .build();
    let witness_len = witness_for_digest.as_bytes().len() as u64;
    blake2b.update(&witness_len.to_le_bytes());
    blake2b.update(&witness_for_digest.as_bytes());
    (1..witnesses_len).for_each(|n| {
        let witness = tx.witnesses().get(n).unwrap();
        let witness_len = witness.raw_data().len() as u64;
        blake2b.update(&witness_len.to_le_bytes());
        blake2b.update(&witness.raw_data());
    });
    blake2b.finalize(&mut message);
    let message = H256::from(message);
    let sig = key.sign_recoverable(&message).expect("sign");
    signed_witnesses.push(
        witness
            .as_builder()
            .lock(Some(Bytes::from(sig.serialize())).pack())
            .build()
            .as_bytes()
            .pack(),
    );
    for i in 1..witnesses_len {
        signed_witnesses.push(tx.witnesses().get(i).unwrap());
    }
    tx.as_advanced_builder()
        .set_witnesses(signed_witnesses)
        .build()
}

pub fn collect_live_inputs(ckb_indexer_client: &mut IndexerRpcClient, need_capacity: u64, lock_args: H160) -> (Vec<packed::CellInput>, u64, Script) {
    let rpc_lock = JsonScript {
        code_hash: SIGHASH_TYPE_HASH.clone(),
        hash_type: JsonScriptHashType::Type,
        args: JsonBytes::from_vec(lock_args.0.to_vec()),
    };

    // no need inputs, just gen the lockscript returned
    if need_capacity == 0 {
        return (vec![], 0, Script::from(rpc_lock));
    }

    let search_key = SearchKey {
        script: rpc_lock.clone(),
        script_type: ScriptType::Lock,
        args_len: None,
    };
    let mut limit = Uint32::try_from(100u32).unwrap();

    let live_cells: Pagination<Cell> = ckb_indexer_client.get_cells(
        search_key,
        Order::Asc,
        limit,
        None,
    ).unwrap();

    println!("unspent_cells: {:?}", live_cells);

    // unspent_cells -> inputs
    let mut actual_capacity = 0u64;
    let mut inputs = vec![];

    for cell in live_cells.objects.iter() {
        // must no type script in case that using the special cells
        if cell.output.type_.is_some() {
            continue;
        }

        let input_out_point: packed::OutPoint = cell.out_point.clone().into();
        let input = packed::CellInput::new_builder()
            .previous_output(input_out_point.clone())
            .build();

        actual_capacity += cell.output.capacity.value();
        inputs.push(input);
    }

    (inputs, actual_capacity, Script::from(rpc_lock))
}

fn multi_sign_tx(
    tx: TransactionView,
    multi_sign_script: &Bytes,
    keys: &[&Privkey],
) -> TransactionView {
    let tx_hash = tx.hash();
    let signed_witnesses: Vec<packed::Bytes> = tx
        .inputs()
        .into_iter()
        .enumerate()
        .map(|(i, _)| {
            if i == 0 {
                let mut blake2b = ckb_hash::new_blake2b();
                let mut message = [0u8; 32];
                blake2b.update(&tx_hash.raw_data());
                let witness = packed::WitnessArgs::new_unchecked(Unpack::<Bytes>::unpack(
                    &tx.witnesses().get(0).unwrap(),
                ));
                let mut lock = multi_sign_script.to_vec();
                let lock_without_sig = {
                    let sig_len = keys.len() * SIGNATURE_SIZE;
                    let mut buf = lock.clone();
                    buf.resize(buf.len() + sig_len, 0);
                    buf
                };
                let witness_without_sig = witness
                    .clone()
                    .as_builder()
                    .lock(Some(Bytes::from(lock_without_sig)).pack())
                    .build();
                let len = witness_without_sig.as_bytes().len() as u64;
                blake2b.update(&len.to_le_bytes());
                blake2b.update(&witness_without_sig.as_bytes());
                (1..tx.witnesses().len()).for_each(|n| {
                    let witness: Bytes = tx.witnesses().get(n).unwrap().unpack();
                    let len = witness.len() as u64;
                    blake2b.update(&len.to_le_bytes());
                    blake2b.update(&witness);
                });
                blake2b.finalize(&mut message);
                let message = H256::from(message);
                keys.iter().for_each(|key| {
                    let sig = key.sign_recoverable(&message).expect("sign");
                    lock.extend_from_slice(&sig.serialize());
                });
                witness
                    .as_builder()
                    .lock(Some(Bytes::from(lock)).pack())
                    .build()
                    .as_bytes()
                    .pack()
            } else {
                tx.witnesses().get(i).unwrap_or_default()
            }
        })
        .collect();
    // calculate message
    tx.as_advanced_builder()
        .set_witnesses(signed_witnesses)
        .build()
}










