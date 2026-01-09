const { ethers } = require("ethers");
const fs = require("fs");

async function createWallet() {
    // Generate a random wallet
    const wallet = ethers.Wallet.createRandom();

    const output = `
--------------------------------------------------------------------------------
New Wallet Generated: ${new Date().toISOString()}
Address: ${wallet.address}
Private Key: ${wallet.privateKey}
Mnemonic: ${wallet.mnemonic.phrase}
--------------------------------------------------------------------------------
`;

    // Print to console
    console.log(output);

    // Append to wallet.txt
    fs.appendFileSync("wallet.txt", output);
    console.log("Wallet details saved to wallet.txt");
}

createWallet();
