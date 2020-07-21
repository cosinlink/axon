use crate::ckb_server::util::gen_lock_args;
use ckb_jsonrpc_types::{
    BannedAddr, Block, BlockNumber, BlockReward, BlockTemplate, BlockView, CellOutputWithOutPoint,
    CellTransaction, CellWithStatus, ChainInfo, EpochNumber, EpochView, HeaderView, LiveCell,
    LockHashIndexState, Node, OutPoint, PeerState, Timestamp, Transaction, TransactionWithStatus,
    TxPoolInfo, Uint64, Version,
    Capacity, CellOutput, JsonBytes, Script, Uint32, ScriptHashType,
};
// use jsonrpc_core::{Error, IoHandler, Result};
use serde::{Deserialize, Serialize};
use ckb_types::{core, packed, prelude::*, H256};
use std::convert::{TryInto, TryFrom};


macro_rules! jsonrpc {
    (
        $(#[$struct_attr:meta])*
        pub struct $struct_name:ident {$(
            $(#[$attr:meta])*
            pub fn $method:ident(&mut $selff:ident $(, $arg_name:ident: $arg_ty:ty)*)
                -> $return_ty:ty;
        )*}
    ) => (
        $(#[$struct_attr])*
        pub struct $struct_name {
            pub client: reqwest::Client,
            pub url: reqwest::Url,
            pub id: u64,
        }

        impl $struct_name {
            pub fn new(uri: &str) -> Self {
                let url = reqwest::Url::parse(uri).expect("ckb uri, e.g. \"http://127.0.0.1:8114\"");
                $struct_name { url, id: 0, client: reqwest::Client::new(), }
            }

            $(
                $(#[$attr])*
                pub fn $method(&mut $selff $(, $arg_name: $arg_ty)*) -> Result<$return_ty, failure::Error> {
                    let method = String::from(stringify!($method));
                    let params = serialize_parameters!($($arg_name,)*);
                    $selff.id += 1;

                    let mut req_json = serde_json::Map::new();
                    req_json.insert("id".to_owned(), serde_json::json!($selff.id));
                    req_json.insert("jsonrpc".to_owned(), serde_json::json!("2.0"));
                    req_json.insert("method".to_owned(), serde_json::json!(method));
                    req_json.insert("params".to_owned(), params);

                    let mut resp = $selff.client.post($selff.url.clone()).json(&req_json).send()?;
                    let output = resp.json::<ckb_jsonrpc_types::response::Output>()?;
                    match output {
                        ckb_jsonrpc_types::response::Output::Success(success) => {
                            serde_json::from_value(success.result).map_err(Into::into)
                        },
                        ckb_jsonrpc_types::response::Output::Failure(failure) => {
                            Err(failure.error.into())
                        }
                    }
                }
            )*
        }
    )
}

macro_rules! serialize_parameters {
    () => ( serde_json::Value::Null );
    ($($arg_name:ident,)+) => ( serde_json::to_value(($($arg_name,)+))?)
}

jsonrpc!(pub struct RawHttpRpcClient {
    pub fn get_tip(&mut self) -> Option<Tip>;

    pub fn get_cells(
        &mut self,
        search_key: SearchKey,
        order: Order,
        limit: Uint32,
        after: Option<JsonBytes>
    ) -> Pagination<Cell>;

    pub fn get_transactions(
        &mut self,
        search_key: SearchKey,
        order: Order,
        limit: Uint32,
        after: Option<JsonBytes>
    ) -> Pagination<Tx>;

    pub fn get_cells_capacity(&mut self, search_key: SearchKey) -> Option<CellsCapacity>;
    });


pub struct IndexerRpcClient {
    url: String,
    client: RawHttpRpcClient,
}

impl IndexerRpcClient {
    pub fn new(url: String) -> IndexerRpcClient {
        let client = RawHttpRpcClient::new(url.as_str());
        IndexerRpcClient { url, client }
    }

    pub fn url(&self) -> &str {
        self.url.as_str()
    }
    pub fn client(&mut self) -> &mut RawHttpRpcClient {
        &mut self.client
    }
}


impl IndexerRpcClient {
    pub fn get_tip(&mut self) -> Result<Option<Tip>, String> {
        self.client
            .get_tip()
            .map(|opt| opt.map(Into::into))
            .map_err(|err| err.to_string())
    }

    pub fn get_cells(
        &mut self,
        search_key: SearchKey,
        order: Order,
        limit: Uint32,
        after: Option<JsonBytes>,
    ) -> Result<Pagination<Cell>, String> {
        self.client
            .get_cells(search_key, order, limit, after)
            .map_err(|err| err.to_string())
    }

    pub fn get_transactions(
        &mut self,
        search_key: SearchKey,
        order: Order,
        limit: Uint32,
        after: Option<JsonBytes>,
    ) -> Result<Pagination<Tx>, String> {
        self.client
            .get_transactions(search_key, order, limit, after)
            .map_err(|err| err.to_string())
    }

    pub fn get_cells_capacity(&mut self, search_key: SearchKey) -> Result<Option<CellsCapacity>, String> {
        self.client
            .get_cells_capacity(search_key)
            .map(|opt| opt.map(Into::into))
            .map_err(|err| err.to_string())
    }
}


#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Debug)]
pub struct SearchKey {
    pub(crate) script: Script,
    pub(crate) script_type: ScriptType,
    pub(crate) args_len: Option<Uint32>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "snake_case")]
pub enum ScriptType {
    Lock,
    Type,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Order {
    Desc,
    Asc,
}

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq, Hash, Debug)]
pub struct Tip {
    pub block_hash: H256,
    pub block_number: BlockNumber,
}

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq, Hash, Debug)]
pub struct CellsCapacity {
    pub capacity: Capacity,
    pub block_hash: H256,
    pub block_number: BlockNumber,
}

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq, Hash, Debug)]
pub struct Cell {
    pub output: CellOutput,
    pub output_data: JsonBytes,
    pub out_point: OutPoint,
    pub block_number: BlockNumber,
    pub tx_index: Uint32,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Debug)]
pub struct Tx {
    pub tx_hash: H256,
    pub block_number: BlockNumber,
    pub tx_index: Uint32,
    pub io_index: Uint32,
    pub io_type: IOType,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "snake_case")]
pub enum IOType {
    Input,
    Output,
}

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq, Hash, Debug)]
pub struct Pagination<T> {
    pub objects: Vec<T>,
    pub last_cursor: JsonBytes,
}


#[test]
pub fn test_rpc() {
    use ckb_sdk::{
        constants::{
            SIGHASH_TYPE_HASH
        },
    };

    let url = "http://0.0.0.0:8116";
    let mut client = IndexerRpcClient::new(url.to_owned());
    let res = client.get_tip();
    println!("get_tip res:  {:?}", res);

    let search = SearchKey {
        script: Script {
            code_hash: H256::try_from([0u8; 32]).unwrap(),
            hash_type: ScriptHashType::Type,
            args: JsonBytes::default(),
        },
        script_type: ScriptType::Lock,
        args_len: None,
    };

    let res = client.get_cells_capacity(search.clone());
    println!("get_cells_capacity res:  {:#?}", res);

    let lock_args = gen_lock_args("0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc".to_owned());
    let search = SearchKey {
        script: Script {
            code_hash: SIGHASH_TYPE_HASH.clone(),
            hash_type: ScriptHashType::Type,
            args: JsonBytes::from_vec(lock_args.0.to_vec()),
        },
        script_type: ScriptType::Lock,
        args_len: None,
    };
    let mut limit = Uint32::try_from(100u32).unwrap();
    let res = client.get_cells(search.clone(), Order::Asc, limit, None);
    println!("get_cells res:  {:#?}", res);


    let res = client.get_transactions(search.clone(), Order::Asc, limit, None);
    println!("get_transactions res:  {:#?}", res);
}