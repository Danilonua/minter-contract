import axios from "axios";
import axiosThrottle from "axios-request-throttle";
axiosThrottle.use(axios, { requestsPerSecond: 0.5 });

import dotenv from "dotenv";
dotenv.config(); // load .env configurations

import fs from "fs";
import path from "path";
import glob from "fast-glob";
import {
  Address,
  Cell,
  CellMessage,
  CommonMessageInfo,
  fromNano,
  InternalMessage,
  StateInit,
  toNano,
} from "ton";
import { TonClient, WalletContract, WalletV3R2Source, contractAddress, SendMode } from "ton";
import { mnemonicToWalletKey } from "ton-crypto";

async function main() {
  console.log(`=================================================================`);
  console.log(`Deploy script running, let's find some contracts to deploy..`);

  const isTestnet = false;
  const client = new TonClient({ endpoint: "https://toncenter.com/api/v2/jsonRPC" });
  console.log(`* We are working with '${isTestnet ? "testnet" : "mainnet"}'`);

  // Check and load Mnemonic
  const deployerMnemonic = process.env.DEPLOYER_MNEMONIC;
  if (!deployerMnemonic) {
    console.error("ERROR: DEPLOYER_MNEMONIC not found in .env file.");
    process.exit(1);
  }

  // Step 1: Generate wallet key from mnemonic
  let walletKey;
  try {
    walletKey = await mnemonicToWalletKey(deployerMnemonic.split(" "));
    console.log(" - Wallet Key generated successfully");
  } catch (error) {
    console.error("ERROR generating wallet key:", error);
    process.exit(1);
  }

  // Step 2: Define the workchain and create wallet contract
  let walletContract;
  const workchain = -1; // Set to -1 for mainnet, as specified

  try {
    console.log("Creating wallet contract...");
    walletContract = WalletContract.create(
      client,
      WalletV3R2Source.create({
        publicKey: walletKey.publicKey,
        workchain,
      })
    );

    if (!walletContract.address) {
      throw new Error("Wallet contract address is undefined after creation");
    }

    console.log(` - Wallet contract created at address: ${walletContract.address.toFriendly()}`);
  } catch (error) {
    console.error("ERROR creating wallet contract:", error);
    process.exit(1);
  }

  // Wallet balance retrieval
  try {
    const walletBalance = await client.getBalance(walletContract.address);
    console.log(` - Wallet balance: ${fromNano(walletBalance)} TON`);
    if (walletBalance.lt(toNano(0.2))) {
      console.error(`ERROR: Wallet has less than 0.2 TON, please fund it.`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR fetching wallet balance: ${error}`);
    process.exit(1);
  }

  // New contract funding amount
  const newContractFunding = toNano(0.02);

  // Deploy contracts
  const rootContracts = glob.sync(["build/*.deploy.ts"]);
  for (const rootContract of rootContracts) {
    console.log(`\n* Found root contract '${rootContract} - deploying':`);
    const contractName = path.parse(path.parse(rootContract).name).name;

    // Load contract init data
    const deployInitScript = require(__dirname + "/../" + rootContract);
    if (typeof deployInitScript.initData !== "function") {
      console.error(`ERROR: '${rootContract}' does not have 'initData()' function`);
      process.exit(1);
    }
    const initDataCell = await deployInitScript.initData();

    if (typeof deployInitScript.initMessage !== "function") {
      console.error(`ERROR: '${rootContract}' does not have 'initMessage()' function`);
      process.exit(1);
    }
    const initMessageCell = await deployInitScript.initMessage();

    // Check if compiled code exists
    const hexArtifact = `build/${contractName}.compiled.json`;
    if (!fs.existsSync(hexArtifact)) {
      console.error(`ERROR: '${hexArtifact}' not found, did you build?`);
      process.exit(1);
    }
    const initCodeCell = Cell.fromBoc(JSON.parse(fs.readFileSync(hexArtifact).toString()).hex)[0];

    // Calculate new contract address
    let newContractAddress;
    try {
      newContractAddress = contractAddress({
        workchain: -1,
        initialData: initDataCell,
        initialCode: initCodeCell,
      });
      console.log(` - Calculated contract address: ${newContractAddress.toFriendly()}`);
    } catch (error) {
      console.error(`ERROR calculating contract address: ${error}`);
      continue;
    }

    // Check if the contract is already deployed
    if (await client.isContractDeployed(newContractAddress)) {
      console.log(` - Contract already deployed, skipping deployment`);
      continue;
    }

    const seqno = await walletContract.getSeqNo();
    const transfer = walletContract.createTransfer({
      secretKey: walletKey.secretKey,
      seqno: seqno,
      sendMode: SendMode.PAY_GAS_SEPARATLY + SendMode.IGNORE_ERRORS,
      order: new InternalMessage({
        to: newContractAddress,
        value: newContractFunding,
        bounce: false,
        body: new CommonMessageInfo({
          stateInit: new StateInit({ data: initDataCell, code: initCodeCell }),
          body: initMessageCell !== null ? new CellMessage(initMessageCell) : null,
        }),
      }),
    });
    await client.sendExternalMessage(walletContract, transfer);
    console.log(` - Deploy transaction sent successfully`);

    // Confirm deployment success
    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(2000);
      const seqnoAfter = await walletContract.getSeqNo();
      if (seqnoAfter > seqno) break;
    }
    if (await client.isContractDeployed(newContractAddress)) {
      console.log(` - SUCCESS! Contract deployed to address: ${newContractAddress.toFriendly()}`);
      const contractBalance = await client.getBalance(newContractAddress);
      console.log(` - New contract balance: ${fromNano(contractBalance)} TON`);
    } else {
      console.log(
        ` - FAILURE! Contract address still looks uninitialized: ${newContractAddress.toFriendly()}`
      );
    }
  }
}

main();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
